import * as cdk from '@aws-cdk/core';
import { Vpc } from '@aws-cdk/aws-ec2'

export class CdkMinecraftStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'MinecraftVpc')
  }
}
