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
import * as dotenv from 'dotenv'

dotenv.config()

const DEBUG: boolean = process.env.DEBUG ? Boolean(process.env.DEBUG) : false 
const TIMEZONE_OFFSET: number = Number(process.env.TIMEZONE_OFFSET) ?? 0
const CONTAINER_ENV: string = process.env.CONTAINER_ENV ? JSON.parse(process.env.CONTAINER_ENV) : {}
const HOSTED_ZONE_ID: string = process.env.HOSTED_ZONE_ID ?? ''
const DNS_RECORD_NAME: string = process.env.DNS_RECORD_NAME ?? ''

export class CdkMinecraftStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const server = new CdkMinecraftSpotPricing(this, 'MinecraftServer', {
      spotPrice: process.env.SPOT_PRICE,
      enableAutomaticBackups: !DEBUG,
      efsRemovalPolicy: DEBUG ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      dnsConfig: {
        hostedZoneId: HOSTED_ZONE_ID,
        recordName: DNS_RECORD_NAME,
      },
      containerEnvironment: CONTAINER_ENV,
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
