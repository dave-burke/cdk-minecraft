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
import { CdkMinecraftSpotPricing, CdkMinecraftSpotPricingProps, CdkMinecraftSpotPricingDnsConfig } from './cdk-minecraft-spot-pricing'

const TEST = true
const TIMEZONE_OFFSET = -6 // CST

export class CdkMinecraftStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const server = new CdkMinecraftSpotPricing(this, 'MinecraftServer', {
      spotPrice: '0.0416',
      enableAutomaticBackups: !TEST,
      efsRemovalPolicy: TEST ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      dnsConfig: {
        hostedZoneId: '[hosted zone ID from Route53]',
        recordName: 'minecraft.example.com',
      },
      containerEnvironment: {
        'EULA': 'true',
        'DIFFICULTY': 'normal',
      },
    })

    new autoscaling.ScheduledAction(this, 'ScaleDown', {
      autoScalingGroup: server.autoScalingGroup,
      schedule: autoscaling.Schedule.cron({ hour: `${22 + TIMEZONE_OFFSET}`, minute: '0' }),
      desiredCapacity: 0,
    })
    new autoscaling.ScheduledAction(this, 'ScaleUp', {
      autoScalingGroup: server.autoScalingGroup,
      schedule: autoscaling.Schedule.cron({ hour: `${15 + TIMEZONE_OFFSET}`, minute: '0' }),
      desiredCapacity: 1,
    })

  }
}
