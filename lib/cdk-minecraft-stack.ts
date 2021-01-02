import * as cdk from '@aws-cdk/core'
import * as autoscaling from '@aws-cdk/aws-autoscaling'
import * as ec2 from '@aws-cdk/aws-ec2'
import * as ecs from '@aws-cdk/aws-ecs'
import * as efs from '@aws-cdk/aws-efs'
import * as events from '@aws-cdk/aws-events'
import * as iam from '@aws-cdk/aws-iam'
import * as lambda from '@aws-cdk/aws-lambda'
import * as path from 'path'
import * as targets from '@aws-cdk/aws-events-targets'

const TEST = true
const INSTANCE_TYPE = 't3.medium'
const SPOT_PRICE = '0.0416'
const MINECRAFT_PORT = 25565
const TIMEZONE_OFFSET = -6 // CST

export class CdkMinecraftStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // Cluster
    const vpc = new ec2.Vpc(this, 'Vpc', { natGateways: 0 })
    const cluster = new ecs.Cluster(this, 'EcsCluster', { vpc })
    cluster.connections.allowFromAnyIpv4(ec2.Port.tcp(MINECRAFT_PORT))

    // Autoscaling
    const autoScalingGroup = cluster.addCapacity('MinecraftServer', {
      instanceType: new ec2.InstanceType(INSTANCE_TYPE),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      maxCapacity: 1,
      minCapacity: 1,
      spotPrice: SPOT_PRICE,
      vpcSubnets: {
        subnets: cluster.vpc.publicSubnets
      },
    })

    new autoscaling.ScheduledAction(this, 'ScaleDown', {
      autoScalingGroup,
      schedule: autoscaling.Schedule.cron({ hour: `${22 + TIMEZONE_OFFSET}`, minute: '0' }),
      maxCapacity: 0,
      minCapacity: 0,
    })
    new autoscaling.ScheduledAction(this, 'ScaleUp', {
      autoScalingGroup,
      schedule: autoscaling.Schedule.cron({ hour: `${15 + TIMEZONE_OFFSET}`, minute: '0' }),
      maxCapacity: 1,
      minCapacity: 1,
    })

    // File system
    const fileSystem = new efs.FileSystem(this, 'ServerFiles', {
      vpc: cluster.vpc,
      encrypted: true,
      enableAutomaticBackups: !TEST,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS,
      removalPolicy: TEST ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    })
    fileSystem.connections.allowDefaultPortFrom(autoScalingGroup)

    // Task definition
    const ec2Task = new ecs.Ec2TaskDefinition(this, 'Ec2Task')
    const container = ec2Task.addContainer('MinecraftServer', {
      image: ecs.ContainerImage.fromRegistry('itzg/minecraft-server:latest'),
      memoryReservationMiB: 1024,
      environment: {
        'EULA': 'true',
        'DIFFICULTY': 'normal',
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'Minecraft' })
    })
    container.addPortMappings({
      containerPort: MINECRAFT_PORT,
      hostPort: MINECRAFT_PORT,
      protocol: ecs.Protocol.TCP,
    })
    ec2Task.addVolume({
      name: 'ServerFilesEfs',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
      },
    })
    container.addMountPoints({
      containerPath: '/data',
      sourceVolume: 'ServerFilesEfs',
      readOnly: false,
    })

    const service = new ecs.Ec2Service(this, 'Ec2Service', {
      cluster,
      taskDefinition: ec2Task,
    })

    // DNS Update
    const dnsUpdateLambda = new lambda.Function(this, 'DnsUpdate', {
      description: 'Set Route53 record for Minecraft',
      runtime: lambda.Runtime.PYTHON_3_7,
      handler: 'dns_update.handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(20),
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        HostedZoneId: '[hosted zone ID from Route53]',
        RecordName: 'minecraft.example.com',
      },
    })
    dnsUpdateLambda.role?.addToPrincipalPolicy(new iam.PolicyStatement({ resources: ['*'], actions: ['route53:*'] }))
    dnsUpdateLambda.role?.addToPrincipalPolicy(new iam.PolicyStatement({ resources: ['*'], actions: ['ec2:DescribeInstance*'] }))

    const rule = new events.Rule(this, 'Ec2InstanceLaunchRule', {
      eventPattern: {
        source: ['aws.autoscaling'],
        detailType: ['EC2 Instance Launch Successful'],
        detail: [ autoScalingGroup.autoScalingGroupName ],
      },
      targets: [ new targets.LambdaFunction(dnsUpdateLambda) ],
    });

  }
}
