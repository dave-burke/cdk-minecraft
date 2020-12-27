import * as cdk from '@aws-cdk/core';
import { Vpc } from '@aws-cdk/aws-ec2'
import * as efs from '@aws-cdk/aws-efs'
import { LifecyclePolicy } from '@aws-cdk/aws-efs';
import { RemovalPolicy } from '@aws-cdk/core';

const test = true;

export class CdkMinecraftStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'MinecraftVpc')

    const fileSystem = new efs.FileSystem(this, 'MinecraftEfs', {
      vpc,
      encrypted: true,
      enableAutomaticBackups: !test,
      lifecyclePolicy: LifecyclePolicy.AFTER_7_DAYS,
      removalPolicy: test ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    })

  }
}
