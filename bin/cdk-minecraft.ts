#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CdkMinecraftStack } from '../lib/cdk-minecraft-stack';

const app = new cdk.App();
new CdkMinecraftStack(app, 'CdkMinecraftStack');
