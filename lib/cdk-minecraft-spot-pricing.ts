import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Construct } from "constructs";

export interface CdkMinecraftSpotPricingDnsConfig {
  hostedZoneId: string;
  recordName: string;
}

export interface CdkMinecraftSpotPricingProps {
  tagName?: string;
  instanceType?: ec2.InstanceType;
  machineImage?: ecs.EcsOptimizedImage;
  spotPrice?: string;
  port?: number;
  ec2KeyName?: string;
  enableAutomaticBackups?: boolean;
  efsRemovalPolicy?: cdk.RemovalPolicy;
  dnsConfig?: CdkMinecraftSpotPricingDnsConfig;
  containerEnvironment?: any;
  containerInsights?: boolean;
  entryPoint?: string[];
  command?: string[];
  logGroupName?: string;
  logGroupRetentionInDays?: logs.RetentionDays;
  logStreamPrefix?: string;
}

const DEFAULT_MINECRAFT_PORT = 25565;

export class CdkMinecraftSpotPricing extends Construct {
  public readonly autoScalingGroup: autoscaling.AutoScalingGroup;

  constructor(
    scope: Construct,
    id: string,
    props: CdkMinecraftSpotPricingProps = {},
  ) {
    super(scope, id);

    props.instanceType =
      props.instanceType ?? new ec2.InstanceType("t4g.medium");
    props.machineImage =
      props.machineImage ??
      ecs.EcsOptimizedImage.amazonLinux2023(ecs.AmiHardwareType.ARM);
    props.port = props.port ?? DEFAULT_MINECRAFT_PORT;
    props.containerEnvironment = props.containerEnvironment ?? {};
    props.containerEnvironment.EULA = "true";
    props.logStreamPrefix = props.logStreamPrefix ?? "minecraft-server";
    props.logGroupRetentionInDays =
      props.logGroupRetentionInDays ?? logs.RetentionDays.ONE_WEEK;
    props.containerInsights = props.containerInsights ?? false;

    // Cluster
    const vpc = new ec2.Vpc(this, "Vpc", { natGateways: 0 });
    const cluster = new ecs.Cluster(this, "EcsCluster", {
      vpc,
      containerInsightsV2: props.containerInsights
        ? ecs.ContainerInsights.ENABLED
        : ecs.ContainerInsights.DISABLED,
    });

    // Security Group
    const securityGroup = new ec2.SecurityGroup(this, "InstanceSecurityGroup", {
      vpc,
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(props.port));
    if (props.ec2KeyName !== undefined) {
      securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22));
    }

    // Autoscaling
    const launchTemplate = new ec2.LaunchTemplate(this, "LaunchTemplate", {
      instanceType: props.instanceType,
      securityGroup,
      machineImage: props.machineImage,
      associatePublicIpAddress: true,
      keyPair: props.ec2KeyName
        ? ec2.KeyPair.fromKeyPairName(this, "KeyPair", props.ec2KeyName)
        : undefined,
      spotOptions: props.spotPrice
        ? { maxPrice: parseFloat(props.spotPrice) }
        : undefined,
      userData: (() => {
        const ud = ec2.UserData.forLinux();
        ud.addCommands(
          `echo ECS_CLUSTER=${cluster.clusterName} >> /etc/ecs/ecs.config`,
        );
        return ud;
      })(),
      role: new iam.Role(this, "InstanceRole", {
        assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonEC2ContainerServiceforEC2Role",
          ),
        ],
      }),
    });

    this.autoScalingGroup = new autoscaling.AutoScalingGroup(
      this,
      "MinecraftServer",
      {
        vpc,
        launchTemplate,
        minCapacity: 0,
        maxCapacity: 1,
        vpcSubnets: {
          subnets: cluster.vpc.publicSubnets,
        },
        newInstancesProtectedFromScaleIn: true,
        updatePolicy: autoscaling.UpdatePolicy.rollingUpdate({
          minInstancesInService: 0, // allow full replacement (server can be down briefly)
          waitOnResourceSignals: false,
        }),
      },
    );

    // Optional CloudWatch Log Group
    let logDriver: ecs.LogDriver | undefined;
    if (props.logGroupName !== undefined) {
      const logGroup = new logs.LogGroup(this, "LogGroup", {
        logGroupName: props.logGroupName,
        retention: props.logGroupRetentionInDays,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });
      logDriver = ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: props.logStreamPrefix!,
      });
    }

    // Task definition
    const ec2Task = new ecs.Ec2TaskDefinition(this, "Ec2Task", {
      networkMode: ecs.NetworkMode.BRIDGE,
    });
    const container = ec2Task.addContainer("MinecraftServer", {
      image: ecs.ContainerImage.fromRegistry(
        `itzg/minecraft-server:${props.tagName ?? "latest"}`,
      ),
      portMappings: [
        {
          containerPort: props.port,
          hostPort: props.port,
          protocol: ecs.Protocol.TCP,
        },
      ],
      memoryReservationMiB: 3072,
      memoryLimitMiB: 3584,
      environment: props.containerEnvironment,
      logging: logDriver,
      entryPoint: props.entryPoint,
      command: props.command,
    });

    // File system
    const fileSystem = new efs.FileSystem(this, "ServerFiles", {
      vpc: cluster.vpc,
      encrypted: true,
      enableAutomaticBackups: props.enableAutomaticBackups,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS,
      removalPolicy: props.efsRemovalPolicy,
    });
    fileSystem.connections.allowDefaultPortFrom(this.autoScalingGroup);
    fileSystem.node.addDependency(securityGroup);

    ec2Task.addVolume({
      name: "ServerFilesEfs",
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
      },
    });

    container.addMountPoints({
      containerPath: "/data",
      sourceVolume: "ServerFilesEfs",
      readOnly: false,
    });

    // Autoscaling
    const capacityProvider = new ecs.AsgCapacityProvider(
      this,
      "CapacityProvider",
      {
        autoScalingGroup: this.autoScalingGroup,
        enableManagedScaling: true,
        enableManagedTerminationProtection: true,
        targetCapacityPercent: 100,
        maximumScalingStepSize: 1,
        minimumScalingStepSize: 1,
      },
    );
    capacityProvider.node.addDependency(this.autoScalingGroup);
    cluster.addAsgCapacityProvider(capacityProvider);

    const ec2Service = new ecs.Ec2Service(this, "Ec2Service", {
      cluster,
      taskDefinition: ec2Task,
      capacityProviderStrategies: [
        {
          capacityProvider: capacityProvider.capacityProviderName,
          weight: 1,
          base: 0,
        },
      ],
      desiredCount: 1,
      maxHealthyPercent: 100,
      minHealthyPercent: 0,
      circuitBreaker: {
        rollback: true,
      },
      placementConstraints: [ecs.PlacementConstraint.distinctInstances()],
      enableExecuteCommand: true,
    });
    ec2Service.node.addDependency(fileSystem);

    // DNS Update
    if (props.dnsConfig !== undefined) {
      const dnsUpdateLambda = new lambda.Function(this, "DnsUpdate", {
        description: "Set Route53 record for Minecraft",
        runtime: lambda.Runtime.PYTHON_3_14,
        handler: "dns_update.handler",
        memorySize: 128,
        timeout: cdk.Duration.seconds(20),
        code: lambda.Code.fromAsset("lambda"),
        environment: {
          HostedZoneId: props.dnsConfig.hostedZoneId,
          RecordName: props.dnsConfig.recordName,
        },
      });
      // Route53 permission
      dnsUpdateLambda.role?.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ["route53:ChangeResourceRecordSets"],
          resources: [
            `arn:aws:route53:::hostedzone/${props.dnsConfig.hostedZoneId}`,
          ],
        }),
      );
      dnsUpdateLambda.role?.addToPrincipalPolicy(
        new iam.PolicyStatement({
          resources: ["*"],
          actions: ["ec2:DescribeInstance*"],
        }),
      );

      const rule = new events.Rule(this, "Ec2InstanceLaunchRule", {
        eventPattern: {
          source: ["aws.autoscaling"],
          detailType: ["EC2 Instance Launch Successful"],
          detail: {
            AutoScalingGroupName: [this.autoScalingGroup.autoScalingGroupName],
          },
        },
        targets: [new targets.LambdaFunction(dnsUpdateLambda)],
      });
      rule.node.addDependency(ec2Service);
    }
  }
}
