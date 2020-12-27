import * as cdk from '@aws-cdk/core'
import * as efs from '@aws-cdk/aws-efs'
import { Vpc, Port } from '@aws-cdk/aws-ec2'
import { LifecyclePolicy } from '@aws-cdk/aws-efs'
import { RemovalPolicy } from '@aws-cdk/core'
import { InstanceType, MachineImage } from '@aws-cdk/aws-ec2'
import { AutoScalingGroup, ScheduledAction, Schedule } from '@aws-cdk/aws-autoscaling'
import * as ecs from '@aws-cdk/aws-ecs'

const TEST = true
const INSTANCE_TYPE = 't4g.medium'
const SPOT_PRICE = '0.0336'

export class CdkMinecraftStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const cluster = new ecs.Cluster(this, 'MinecraftCluster')
    cluster.connections.allowFromAnyIpv4(Port.tcp(22565))

    const autoScalingGroup = cluster.addCapacity('MinecraftServer', {
      instanceType: new InstanceType(INSTANCE_TYPE),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      desiredCapacity: 1,
      spotPrice: SPOT_PRICE,
    })

    new ScheduledAction(this, 'ScaleDownMinecraft', {
      autoScalingGroup,
      schedule: Schedule.cron({ hour: '22', minute: '0' }),
      desiredCapacity: 0
    })
    new ScheduledAction(this, 'ScaleUpMinecraft', {
      autoScalingGroup,
      schedule: Schedule.cron({ hour: '15', minute: '0' }),
      desiredCapacity: 1
    })

    const fileSystem = new efs.FileSystem(this, 'MinecraftEfs', {
      vpc: cluster.vpc,
      encrypted: true,
      enableAutomaticBackups: !TEST,
      lifecyclePolicy: LifecyclePolicy.AFTER_7_DAYS,
      removalPolicy: TEST? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    })

    const ec2Task = new ecs.Ec2TaskDefinition(this, 'MinecraftTask')
    const container = ec2Task.addContainer('MinecraftServerContainer', {
      image: ecs.ContainerImage.fromRegistry('itzg/minecraft:latest'),
      memoryReservationMiB: 1024,
      environment: {
        'EULA': 'true',
        'DIFFICULTY': 'normal',
      }
    })
    container.addPortMappings({
      containerPort: 25565,
      hostPort: 25565,
      protocol: ecs.Protocol.TCP,
    })
    ec2Task.addVolume({
      name: 'MinecraftEfsVolume',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
      },
    })
    container.addMountPoints({
      containerPath: '/data',
      sourceVolume: 'MinecraftEfsVolume',
      readOnly: false,
    })

    const service = new ecs.Ec2Service(this, 'MinecraftService', {
      cluster,
      taskDefinition: ec2Task,
    })
  }
}
