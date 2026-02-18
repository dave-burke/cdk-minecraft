#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { CdkMinecraftStack } from "../lib/cdk-minecraft-stack";
import "dotenv/config";

const app = new App();
new CdkMinecraftStack(app, "CdkMinecraftStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
