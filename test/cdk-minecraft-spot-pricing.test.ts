import { describe, it, expect, beforeEach } from "vitest";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Template, Match } from "aws-cdk-lib/assertions";
import { CdkMinecraftSpotPricing } from "../lib/cdk-minecraft-spot-pricing";

function buildTemplate(
  props: ConstructorParameters<typeof CdkMinecraftSpotPricing>[2] = {},
) {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, "TestStack");
  new CdkMinecraftSpotPricing(stack, "Minecraft", props);
  return Template.fromStack(stack);
}

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------
describe("CdkMinecraftSpotPricing – defaults", () => {
  let template: Template;

  beforeEach(() => {
    template = buildTemplate();
  });

  it("creates a VPC", () => {
    template.resourceCountIs("AWS::EC2::VPC", 1);
  });

  it("creates an ECS cluster", () => {
    template.resourceCountIs("AWS::ECS::Cluster", 1);
  });

  it("creates an EFS filesystem that is encrypted", () => {
    template.hasResourceProperties("AWS::EFS::FileSystem", {
      Encrypted: true,
    });
  });

  it("creates an Auto Scaling Group with min/max capacity of 1", () => {
    template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
      MinSize: "1",
      MaxSize: "1",
    });
  });

  it("creates a launch configuration with t3.medium instance type", () => {
    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      InstanceType: "t3.medium",
    });
  });

  it("creates an ECS task definition", () => {
    template.resourceCountIs("AWS::ECS::TaskDefinition", 1);
  });

  it("creates an ECS service", () => {
    template.resourceCountIs("AWS::ECS::Service", 1);
  });

  it("uses the itzg/minecraft-server:latest container image", () => {
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Image: "itzg/minecraft-server:latest",
        }),
      ]),
    });
  });

  it("sets EULA=true in container environment", () => {
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([{ Name: "EULA", Value: "true" }]),
        }),
      ]),
    });
  });

  it("maps container port 25565 (default Minecraft port)", () => {
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          PortMappings: Match.arrayWith([
            Match.objectLike({ ContainerPort: 25565, HostPort: 25565 }),
          ]),
        }),
      ]),
    });
  });

  it("mounts /data from EFS volume in the container", () => {
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          MountPoints: Match.arrayWith([
            Match.objectLike({
              ContainerPath: "/data",
              ReadonlyRootFilesystem: Match.absent(),
            }),
          ]),
        }),
      ]),
    });
  });

  it("does NOT create a DNS Lambda or EventBridge rule by default (no dnsConfig)", () => {
    template.resourceCountIs("AWS::Events::Rule", 0);
    const lambdas = template.findResources("AWS::Lambda::Function", {
      Properties: { Description: "Set Route53 record for Minecraft" },
    });
    expect(Object.keys(lambdas)).toHaveLength(0);
  });

  it("does NOT open SSH port by default (no ec2KeyName)", () => {
    // There should be no ingress rule targeting port 22
    const template2 = buildTemplate();
    const securityGroups = template2.findResources("AWS::EC2::SecurityGroup");
    const hasSshIngress = Object.values(securityGroups).some((sg: any) =>
      (sg.Properties?.SecurityGroupIngress ?? []).some(
        (rule: any) => rule.FromPort === 22 || rule.ToPort === 22,
      ),
    );
    expect(hasSshIngress).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Custom props
// ---------------------------------------------------------------------------
describe("CdkMinecraftSpotPricing – custom props", () => {
  it("uses a custom container image tag", () => {
    const template = buildTemplate({ tagName: "java17" });
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({ Image: "itzg/minecraft-server:java17" }),
      ]),
    });
  });

  it("uses a custom instance type", () => {
    const template = buildTemplate({
      instanceType: new ec2.InstanceType("m5.xlarge"),
    });
    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      InstanceType: "m5.xlarge",
    });
  });

  it("uses a custom port", () => {
    const template = buildTemplate({ port: 19132 });
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          PortMappings: Match.arrayWith([
            Match.objectLike({ ContainerPort: 19132, HostPort: 19132 }),
          ]),
        }),
      ]),
    });
  });

  it("sets a spot price on the launch configuration when spotPrice is provided", () => {
    const template = buildTemplate({ spotPrice: "0.05" });
    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      SpotPrice: "0.05",
    });
  });

  it("opens port 22 and sets the key name when ec2KeyName is provided", () => {
    const template = buildTemplate({ ec2KeyName: "my-key" });
    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      KeyName: "my-key",
    });
    // SSH ingress should exist somewhere in the security groups
    const securityGroups = template.findResources("AWS::EC2::SecurityGroup");
    const hasSshIngress = Object.values(securityGroups).some((sg: any) =>
      (sg.Properties?.SecurityGroupIngress ?? []).some(
        (rule: any) => rule.FromPort === 22,
      ),
    );
    expect(hasSshIngress).toBe(true);
  });

  it("sets enableAutomaticBackups on the EFS filesystem", () => {
    const template = buildTemplate({ enableAutomaticBackups: true });
    template.hasResourceProperties("AWS::EFS::FileSystem", {
      BackupPolicy: { Status: "ENABLED" },
    });
  });

  it("merges custom containerEnvironment variables (and still sets EULA)", () => {
    const template = buildTemplate({
      containerEnvironment: { DIFFICULTY: "hard" },
    });
    // Both EULA (always injected) and the custom variable must appear
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([{ Name: "EULA", Value: "true" }]),
        }),
      ]),
    });
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([{ Name: "DIFFICULTY", Value: "hard" }]),
        }),
      ]),
    });
  });
});

// ---------------------------------------------------------------------------
// DNS config
// ---------------------------------------------------------------------------
describe("CdkMinecraftSpotPricing – dnsConfig", () => {
  let template: Template;

  beforeEach(() => {
    template = buildTemplate({
      dnsConfig: {
        hostedZoneId: "Z123456ABCDEFG",
        recordName: "minecraft.example.com",
      },
    });
  });

  it("creates a Lambda function for DNS updates", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Description: "Set Route53 record for Minecraft",
    });
  });

  it("uses Python 3.14 runtime for the Lambda", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "python3.14",
    });
  });

  it("passes HostedZoneId and RecordName as Lambda environment variables", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          HostedZoneId: "Z123456ABCDEFG",
          RecordName: "minecraft.example.com",
        }),
      },
    });
  });

  it("creates an EventBridge rule that listens for EC2 Instance Launch Successful", () => {
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: Match.objectLike({
        source: ["aws.autoscaling"],
        "detail-type": ["EC2 Instance Launch Successful"],
      }),
    });
  });

  it("grants route53:* and ec2:DescribeInstance* to the Lambda role", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "route53:*", Effect: "Allow" }),
          Match.objectLike({
            Action: "ec2:DescribeInstance*",
            Effect: "Allow",
          }),
        ]),
      }),
    });
  });

  it("does NOT create a DNS Lambda or EventBridge rule when dnsConfig is omitted", () => {
    const t = buildTemplate();
    t.resourceCountIs("AWS::Events::Rule", 0);
    const lambdas = t.findResources("AWS::Lambda::Function", {
      Properties: { Description: "Set Route53 record for Minecraft" },
    });
    expect(Object.keys(lambdas)).toHaveLength(0);
  });
});
