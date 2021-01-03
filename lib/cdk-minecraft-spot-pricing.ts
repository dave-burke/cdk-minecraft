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

export interface CdkMinecraftSpotPricingDnsConfig {
  hostedZoneId: string,
  recordName: string,
}

export interface CdkMinecraftSpotPricingProps {
  tagName?: string,
  instanceType?: string,
  spotPrice?: string,
  port?: number,
  ec2KeyName?: string,
  enableAutomaticBackups?: boolean,
  efsRemovalPolicy?: cdk.RemovalPolicy, 
  dnsConfig?: CdkMinecraftSpotPricingDnsConfig,
  containerEnvironment?: any,
}

export class CdkMinecraftSpotPricing extends cdk.Construct {
  public readonly autoScalingGroup: autoscaling.AutoScalingGroup

  constructor(scope: cdk.Construct, id: string, props: CdkMinecraftSpotPricingProps = {}) {
    super(scope, id)

    props.instanceType = props.instanceType ?? 't3.medium'
    props.port = props.port ?? 25565
    props.containerEnvironment = props.containerEnvironment ?? { }
    props.containerEnvironment.EULA = 'true'

    // Cluster
    const vpc = new ec2.Vpc(this, 'Vpc', { natGateways: 0 })
    const cluster = new ecs.Cluster(this, 'EcsCluster', { vpc })
    cluster.connections.allowFromAnyIpv4(ec2.Port.tcp(props.port))

    // Autoscaling
    this.autoScalingGroup = cluster.addCapacity('MinecraftServer', {
      instanceType: new ec2.InstanceType(props.instanceType),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      desiredCapacity: 1,
      spotPrice: props.spotPrice,
      vpcSubnets: {
        subnets: cluster.vpc.publicSubnets
      },
      keyName: props.ec2KeyName,
    })
    if(props.ec2KeyName !== undefined) {
      this.autoScalingGroup.connections.allowFromAnyIpv4(ec2.Port.tcp(22))
    }

    // File system
    const fileSystem = new efs.FileSystem(this, 'ServerFiles', {
      vpc: cluster.vpc,
      encrypted: true,
      enableAutomaticBackups: props.enableAutomaticBackups,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS,
      removalPolicy: props.efsRemovalPolicy,
    })
    fileSystem.connections.allowDefaultPortFrom(this.autoScalingGroup)

    // Task definition
    const ec2Task = new ecs.Ec2TaskDefinition(this, 'Ec2Task')
    const container = ec2Task.addContainer('MinecraftServer', {
      image: ecs.ContainerImage.fromRegistry(`itzg/minecraft-server:${props.tagName ?? 'latest'}`),
      memoryReservationMiB: 1024,
      environment: props.containerEnvironment,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'Minecraft' })
    })
    container.addPortMappings({
      containerPort: props.port,
      hostPort: props.port,
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
    if(props.dnsConfig !== undefined) {
      const dnsUpdateLambda = new lambda.Function(this, 'DnsUpdate', {
        description: 'Set Route53 record for Minecraft',
        runtime: lambda.Runtime.PYTHON_3_7,
        handler: 'dns_update.handler',
        memorySize: 128,
        timeout: cdk.Duration.seconds(20),
        code: lambda.Code.fromAsset('lambda'),
        environment: {
          HostedZoneId: props.dnsConfig.hostedZoneId,
          RecordName: props.dnsConfig.recordName,
        },
      })
      dnsUpdateLambda.role?.addToPrincipalPolicy(new iam.PolicyStatement({ resources: ['*'], actions: ['route53:*'] }))
      dnsUpdateLambda.role?.addToPrincipalPolicy(new iam.PolicyStatement({ resources: ['*'], actions: ['ec2:DescribeInstance*'] }))

      const rule = new events.Rule(this, 'Ec2InstanceLaunchRule', {
        eventPattern: {
          source: ['aws.autoscaling'],
          detailType: ['EC2 Instance Launch Successful'],
          detail: {
            'AutoScalingGroupName': [ this.autoScalingGroup.autoScalingGroupName ],
          },
        },
        targets: [ new targets.LambdaFunction(dnsUpdateLambda) ],
      })
    }
  }
}
