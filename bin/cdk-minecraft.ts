#!/usr/bin/env node
import "source-map-support/register";
import { App, Tags } from "aws-cdk-lib";
import { CdkMinecraftStack } from "../lib/cdk-minecraft-stack";
import "dotenv/config";

const app = new App();
const stack = new CdkMinecraftStack(app, "CdkMinecraftStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

Tags.of(stack).add("project", "minecraft-spot-pricing");
Tags.of(stack).add("iac", "cdk");
