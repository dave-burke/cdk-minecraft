import * as cdk from '@aws-cdk/core'
import * as efs from '@aws-cdk/aws-efs'
import { Vpc, Port } from '@aws-cdk/aws-ec2'
import { LifecyclePolicy } from '@aws-cdk/aws-efs'
import { RemovalPolicy } from '@aws-cdk/core'
import { InstanceType, MachineImage } from '@aws-cdk/aws-ec2'
import { AutoScalingGroup, ScheduledAction, Schedule } from '@aws-cdk/aws-autoscaling'

const TEST = true
const INSTANCE_TYPE = 't4g.medium'

export class CdkMinecraftStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const vpc = new Vpc(this, 'MinecraftVpc')

    const server = new AutoScalingGroup(this, 'MinecraftServer', {
      vpc,
      instanceType: new InstanceType(INSTANCE_TYPE),
      machineImage: MachineImage.latestAmazonLinux(),
      desiredCapacity: 1,
    })
    server.connections.allowFromAnyIpv4(Port.tcp(22565))

    new ScheduledAction(this, 'ScaleDownMinecraft', {
      autoScalingGroup: server,
      schedule: Schedule.cron({ hour: '22', minute: '0' }),
      desiredCapacity: 0
    })
    new ScheduledAction(this, 'ScaleUpMinecraft', {
      autoScalingGroup: server,
      schedule: Schedule.cron({ hour: '15', minute: '0' }),
      desiredCapacity: 1
    })

    const fileSystem = new efs.FileSystem(this, 'MinecraftEfs', {
      vpc,
      encrypted: true,
      enableAutomaticBackups: !TEST,
      lifecyclePolicy: LifecyclePolicy.AFTER_7_DAYS,
      removalPolicy: TEST? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    })

    fileSystem.connections.allowDefaultPortFrom(server)

    server.userData.addCommands("yum check-update -y",
      "yum upgrade -y",
      "yum install -y amazon-efs-utils",
      "yum install -y nfs-utils",
      "file_system_id_1=" + fileSystem.fileSystemId,
      "efs_mount_point_1=/mnt/efs/fs1",
      "mkdir -p \"${efs_mount_point_1}\"",
      "test -f \"/sbin/mount.efs\" && echo \"${file_system_id_1}:/ ${efs_mount_point_1} efs defaults,_netdev\" >> /etc/fstab || " +
      "echo \"${file_system_id_1}.efs." + this.region + ".amazonaws.com:/ ${efs_mount_point_1} nfs4 nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport,_netdev 0 0\" >> /etc/fstab",
      "mount -a -t efs,nfs4 defaults");
  }
}
