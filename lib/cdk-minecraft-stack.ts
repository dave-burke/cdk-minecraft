import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
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
const HOSTED_ZONE_ID: string = process.env.HOSTED_ZONE_ID ?? "";
const DNS_RECORD_NAME: string = process.env.DNS_RECORD_NAME ?? "";

export class CdkMinecraftStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const server = new CdkMinecraftSpotPricing(this, "MinecraftServer", {
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
      logGroupName: process.env.LOG_GROUP_NAME,
      ec2KeyName: process.env.EC2_KEY_NAME,
      containerInsights: true,
    });

    // Weekday schedule: 3PM-9PM
    new autoscaling.ScheduledAction(this, "ScaleUpWeekdays", {
      autoScalingGroup: server.autoScalingGroup,
      schedule: autoscaling.Schedule.cron({
        weekDay: "1-5",
        hour: "15",
        minute: "0",
      }),
      timeZone: `${process.env.TIMEZONE}`,
      minCapacity: 0,
      desiredCapacity: 1,
      maxCapacity: 1,
    });
    new autoscaling.ScheduledAction(this, "ScaleDownWeekdays", {
      autoScalingGroup: server.autoScalingGroup,
      schedule: autoscaling.Schedule.cron({
        weekDay: "1-5",
        hour: "21",
        minute: "0",
      }),
      timeZone: `${process.env.TIMEZONE}`,
      minCapacity: 0,
      desiredCapacity: 0,
      maxCapacity: 0,
    });

    // Weekend schedule: 7AM-9PM
    new autoscaling.ScheduledAction(this, "ScaleUpWeekends", {
      autoScalingGroup: server.autoScalingGroup,
      schedule: autoscaling.Schedule.cron({
        weekDay: "0,6",
        hour: "7",
        minute: "0",
      }),
      timeZone: `${process.env.TIMEZONE}`,
      minCapacity: 0,
      desiredCapacity: 1,
      maxCapacity: 1,
    });
    new autoscaling.ScheduledAction(this, "ScaleDownWeekends", {
      autoScalingGroup: server.autoScalingGroup,
      schedule: autoscaling.Schedule.cron({
        weekDay: "0,6",
        hour: "21",
        minute: "0",
      }),
      timeZone: `${process.env.TIMEZONE}`,
      minCapacity: 0,
      desiredCapacity: 0,
      maxCapacity: 0,
    });
  }
}
