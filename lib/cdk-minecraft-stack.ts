import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { CdkMinecraftSpotPricing } from "./cdk-minecraft-spot-pricing";
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config();

const CONTAINER_ENV_FILE = ".env.container";
const containerEnvironment = fs.existsSync(CONTAINER_ENV_FILE)
  ? dotenv.parse(fs.readFileSync(".env.container"))
  : {};

const DEBUG: boolean = process.env.DEBUG ? Boolean(process.env.DEBUG) : false;
const TIMEZONE_OFFSET: number = Number.isNaN(process.env.TIMEZONE_OFFSET)
  ? Number(process.env.TIMEZONE_OFFSET)
  : 0;
const HOSTED_ZONE_ID: string = process.env.HOSTED_ZONE_ID ?? "";
const DNS_RECORD_NAME: string = process.env.DNS_RECORD_NAME ?? "";

export class CdkMinecraftStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const server = new CdkMinecraftSpotPricing(this, "MinecraftServer", {
      instanceType: new ec2.InstanceType("t4g.medium"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.ARM),
      tagName: "multiarch",
      containerEnvironment,
      spotPrice: process.env.SPOT_PRICE,
      enableAutomaticBackups: !DEBUG,
      efsRemovalPolicy: DEBUG
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
      dnsConfig: DEBUG
        ? undefined
        : {
            hostedZoneId: HOSTED_ZONE_ID,
            recordName: DNS_RECORD_NAME,
          },
      ec2KeyName: process.env.EC2_KEY_NAME,
    });

    new autoscaling.ScheduledAction(this, "ScaleDown", {
      autoScalingGroup: server.autoScalingGroup,
      schedule: autoscaling.Schedule.cron({
        hour: `${22 - TIMEZONE_OFFSET}`,
        minute: "0",
      }),
      minCapacity: 0,
      maxCapacity: 0,
    });
    new autoscaling.ScheduledAction(this, "ScaleUp", {
      autoScalingGroup: server.autoScalingGroup,
      schedule: autoscaling.Schedule.cron({
        hour: `${15 - TIMEZONE_OFFSET}`,
        minute: "0",
      }),
      minCapacity: 1,
      maxCapacity: 1,
    });
  }
}
