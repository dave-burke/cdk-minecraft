import * as cdk from "aws-cdk-lib";
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

    const tz = process.env.TIMEZONE;
    server.makeSchedule("StartWeekdays", "0 15 ? * MON-FRI *", 1, tz);
    server.makeSchedule("StopWeekdays", "0 21 ? * MON-FRI *", 0, tz);
    server.makeSchedule("StartWeekends", "0 7  ? * SAT,SUN *", 1, tz);
    server.makeSchedule("StopWeekends", "0 21 ? * SAT,SUN *", 0, tz);
  }
}
