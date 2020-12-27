import * as cdk from '@aws-cdk/core'
import * as efs from '@aws-cdk/aws-efs'
import * as ec2 from '@aws-cdk/aws-ec2'
import { LifecyclePolicy } from '@aws-cdk/aws-efs'
import { RemovalPolicy } from '@aws-cdk/core'
import { InstanceType, MachineImage } from '@aws-cdk/aws-ec2'

const TEST = true
const INSTANCE_TYPE = 't4g.medium'

export class CdkMinecraftStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const vpc = new ec2.Vpc(this, 'MinecraftVpc')

    const server = new ec2.Instance(this, 'MinecraftServer', {
      vpc,
      instanceType: new InstanceType(INSTANCE_TYPE),
      machineImage: MachineImage.latestAmazonLinux(),
    })
    server.connections.allowFromAnyIpv4(ec2.Port.tcp(22565))

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
