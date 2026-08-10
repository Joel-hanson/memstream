/** Memstream EC2 demo stack — parameterized CFN (Enable / deploy-aws). */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Package root whether running from src or dist/lib. */
const PKG_ROOT = HERE.endsWith(`${join("dist", "lib")}`) || HERE.endsWith("dist/lib")
  ? join(HERE, "..", "..")
  : join(HERE, "..");

export class MemstreamEc2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.templateOptions.description =
      "Memstream demo box — EC2 (shop + S3 watcher), IAM instance role " +
      "(S3 CDC + deploy package + Bedrock embeddings), security group. " +
      "Cockroach Cloud and changefeed stay outside this stack.";

    const instanceType = new cdk.CfnParameter(this, "InstanceType", {
      type: "String",
      default: "t3.micro",
      allowedValues: ["t3.micro", "t3.small", "t2.micro", "t4g.micro", "t4g.small"],
      description:
        "t3/t2 = x86_64; t4g = arm64 (use with linux/arm64 prebuild on Apple Silicon).",
    });

    const amiIdX86 = new cdk.CfnParameter(this, "AmiIdX86", {
      type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>",
      default:
        "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64",
      description: "Amazon Linux 2023 x86_64 AMI (resolved via SSM).",
    });

    const amiIdArm = new cdk.CfnParameter(this, "AmiIdArm", {
      type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>",
      default:
        "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64",
      description: "Amazon Linux 2023 arm64 AMI (resolved via SSM).",
    });

    const cdcS3Bucket = new cdk.CfnParameter(this, "CdcS3Bucket", {
      type: "String",
      description: "Existing S3 bucket used for CDC (and the deploy tarball).",
      allowedPattern: "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$",
    });

    const cdcS3Prefix = new cdk.CfnParameter(this, "CdcS3Prefix", {
      type: "String",
      default: "cdc/",
      description: "Prefix the changefeed writes under.",
    });

    const deployObjectKey = new cdk.CfnParameter(this, "DeployObjectKey", {
      type: "String",
      default: "deploy/memstream-prebuilt.tgz",
      description:
        "Object key for the prebuilt tarball uploaded by scripts/deploy-aws.sh.",
    });

    const configSecretArn = new cdk.CfnParameter(this, "ConfigSecretArn", {
      type: "String",
      default: "",
      description:
        "Secrets Manager ARN for JSON {DATABASE_URL, MEMSTREAM_DATABASE_URL, MEMSTREAM_SECRETS_KEY}. Prefer this over legacy plaintext parameters (which should stay empty).",
    });

    const databaseUrl = new cdk.CfnParameter(this, "DatabaseUrl", {
      type: "String",
      noEcho: true,
      default: "",
      description: "DEPRECATED. Use ConfigSecretArn.",
    });

    const memstreamDatabaseUrl = new cdk.CfnParameter(
      this,
      "MemstreamDatabaseUrl",
      {
        type: "String",
        noEcho: true,
        default: "",
        description: "DEPRECATED. Use ConfigSecretArn.",
      },
    );

    const memstreamSecretsKey = new cdk.CfnParameter(
      this,
      "MemstreamSecretsKey",
      {
        type: "String",
        noEcho: true,
        default: "",
        description: "DEPRECATED. Use ConfigSecretArn.",
      },
    );

    const memstreamWorkerCompute = new cdk.CfnParameter(
      this,
      "MemstreamWorkerCompute",
      {
        type: "String",
        default: "ec2",
        allowedValues: ["ec2", "lambda"],
        description:
          "Default cloud worker when Enable runs on this host (UI can override). lambda deploys an S3-triggered function and stops memstream-watch.",
      },
    );

    const bedrockEmbedModel = new cdk.CfnParameter(this, "BedrockEmbedModel", {
      type: "String",
      default: "amazon.titan-embed-text-v2:0",
    });

    const memoryProfile = new cdk.CfnParameter(this, "MemoryProfile", {
      type: "String",
      default: "commerce",
      description:
        "Profile id (or legacy path like profiles/commerce.yaml). Content is loaded from memstream_profiles.",
    });

    const shopCidr = new cdk.CfnParameter(this, "ShopCidr", {
      type: "String",
      default: "0.0.0.0/0",
      description:
        "CIDR allowed to reach the console/shop on port 3000. Default is open for demos; tighten to YOUR_IP/32 for real use.",
      allowedPattern: "^(\\d{1,3}\\.){3}\\d{1,3}/\\d{1,2}$",
    });

    const keyName = new cdk.CfnParameter(this, "KeyName", {
      type: "String",
      default: "",
      description:
        "Optional EC2 key pair for SSH. Prefer SSM Session Manager (always enabled).",
    });

    // Keep refs used so synth does not drop parameters (UserData Sub resolves by name).
    void databaseUrl;
    void memstreamDatabaseUrl;
    void memstreamSecretsKey;
    void memstreamWorkerCompute;
    void bedrockEmbedModel;
    void memoryProfile;
    void cdcS3Prefix;
    void deployObjectKey;

    const hasKeyName = new cdk.CfnCondition(this, "HasKeyName", {
      expression: cdk.Fn.conditionNot(
        cdk.Fn.conditionEquals(keyName.valueAsString, ""),
      ),
    });

    const hasConfigSecret = new cdk.CfnCondition(this, "HasConfigSecret", {
      expression: cdk.Fn.conditionNot(
        cdk.Fn.conditionEquals(configSecretArn.valueAsString, ""),
      ),
    });

    const useArmAmi = new cdk.CfnCondition(this, "UseArmAmi", {
      expression: cdk.Fn.conditionOr(
        cdk.Fn.conditionEquals(instanceType.valueAsString, "t4g.micro"),
        cdk.Fn.conditionEquals(instanceType.valueAsString, "t4g.small"),
      ),
    });

    const instanceRole = new iam.CfnRole(this, "InstanceRole", {
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "ec2.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      },
      managedPolicyArns: [
        "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
      ],
      policies: [
        {
          policyName: "memstream-s3-bedrock",
          policyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Sid: "ListCdcBucket",
                Effect: "Allow",
                Action: ["s3:ListBucket", "s3:GetBucketLocation"],
                Resource: cdk.Fn.sub("arn:aws:s3:::${CdcS3Bucket}"),
              },
              {
                Sid: "ReadCdcAndDeploy",
                Effect: "Allow",
                Action: ["s3:GetObject"],
                Resource: [
                  cdk.Fn.sub("arn:aws:s3:::${CdcS3Bucket}/${CdcS3Prefix}*"),
                  cdk.Fn.sub("arn:aws:s3:::${CdcS3Bucket}/${DeployObjectKey}"),
                ],
              },
              {
                Sid: "WriteCdcForChangefeed",
                Effect: "Allow",
                Action: [
                  "s3:PutObject",
                  "s3:DeleteObject",
                  "s3:AbortMultipartUpload",
                ],
                Resource: cdk.Fn.sub("arn:aws:s3:::${CdcS3Bucket}/${CdcS3Prefix}*"),
              },
              {
                Sid: "UploadLambdaZip",
                Effect: "Allow",
                Action: ["s3:PutObject", "s3:GetObject"],
                Resource: cdk.Fn.sub("arn:aws:s3:::${CdcS3Bucket}/deploy/*"),
              },
              {
                Sid: "S3BucketNotifications",
                Effect: "Allow",
                Action: [
                  "s3:GetBucketNotification",
                  "s3:PutBucketNotification",
                ],
                Resource: cdk.Fn.sub("arn:aws:s3:::${CdcS3Bucket}"),
              },
              {
                Sid: "DeployLambdaStack",
                Effect: "Allow",
                Action: [
                  "cloudformation:CreateStack",
                  "cloudformation:UpdateStack",
                  "cloudformation:DeleteStack",
                  "cloudformation:DescribeStacks",
                  "cloudformation:DescribeStackEvents",
                  "cloudformation:DescribeStackResources",
                  "cloudformation:GetTemplate",
                  "cloudformation:ValidateTemplate",
                ],
                Resource: "*",
              },
              {
                Sid: "ManageLambdaWorker",
                Effect: "Allow",
                Action: [
                  "lambda:CreateFunction",
                  "lambda:UpdateFunctionCode",
                  "lambda:UpdateFunctionConfiguration",
                  "lambda:GetFunction",
                  "lambda:GetFunctionConfiguration",
                  "lambda:DeleteFunction",
                  "lambda:AddPermission",
                  "lambda:RemovePermission",
                  "lambda:GetPolicy",
                  "lambda:ListVersionsByFunction",
                  "lambda:TagResource",
                  "lambda:UntagResource",
                  "lambda:ListTags",
                  "lambda:InvokeFunction",
                ],
                Resource: "*",
              },
              {
                Sid: "PassAndManageLambdaRole",
                Effect: "Allow",
                Action: [
                  "iam:CreateRole",
                  "iam:DeleteRole",
                  "iam:GetRole",
                  "iam:PassRole",
                  "iam:TagRole",
                  "iam:UntagRole",
                  "iam:PutRolePolicy",
                  "iam:DeleteRolePolicy",
                  "iam:GetRolePolicy",
                  "iam:AttachRolePolicy",
                  "iam:DetachRolePolicy",
                  "iam:ListAttachedRolePolicies",
                  "iam:ListRolePolicies",
                ],
                Resource: "*",
              },
              {
                Sid: "BedrockEmbed",
                Effect: "Allow",
                Action: ["bedrock:InvokeModel"],
                Resource: "*",
              },
              {
                Sid: "ReadDeployConfigSecret",
                Effect: "Allow",
                Action: [
                  "secretsmanager:GetSecretValue",
                  "secretsmanager:DescribeSecret",
                ],
                Resource: cdk.Fn.conditionIf(
                  hasConfigSecret.logicalId,
                  configSecretArn.valueAsString,
                  cdk.Fn.sub(
                    "arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:memstream/*",
                  ),
                ),
              },
            ],
          },
        },
      ],
    });

    const instanceProfile = new iam.CfnInstanceProfile(this, "InstanceProfile", {
      roles: [instanceRole.ref],
    });

    const securityGroup = new ec2.CfnSecurityGroup(this, "SecurityGroup", {
      groupDescription:
        "Memstream console/shop (3000); SSM for shell (no SSH ingress)",
      securityGroupIngress: [
        {
          ipProtocol: "tcp",
          fromPort: 3000,
          toPort: 3000,
          cidrIp: shopCidr.valueAsString,
          description: "Memstream Next.js console + shop",
        },
      ],
      tags: [
        {
          key: "Name",
          value: cdk.Fn.sub("${AWS::StackName}-sg"),
        },
      ],
    });

    const userdataPath = join(PKG_ROOT, "assets", "ec2-userdata.sh");
    const userdataBody = readFileSync(userdataPath, "utf-8");

    const demoInstance = new ec2.CfnInstance(this, "DemoInstance", {
      instanceType: instanceType.valueAsString,
      iamInstanceProfile: instanceProfile.ref,
      securityGroupIds: [securityGroup.attrGroupId],
      tags: [
        {
          key: "Name",
          value: cdk.Fn.sub("${AWS::StackName}-demo"),
        },
      ],
      userData: cdk.Fn.base64(cdk.Fn.sub(userdataBody)),
    });

    demoInstance.addPropertyOverride(
      "ImageId",
      cdk.Fn.conditionIf(
        useArmAmi.logicalId,
        amiIdArm.valueAsString,
        amiIdX86.valueAsString,
      ),
    );
    demoInstance.addPropertyOverride(
      "KeyName",
      cdk.Fn.conditionIf(
        hasKeyName.logicalId,
        keyName.valueAsString,
        cdk.Aws.NO_VALUE,
      ),
    );

    new cdk.CfnOutput(this, "InstanceId", {
      description: "EC2 instance id",
      value: demoInstance.ref,
    });
    new cdk.CfnOutput(this, "PublicIp", {
      description:
        "Public IPv4 (changes if you stop/start without an Elastic IP)",
      value: demoInstance.attrPublicIp,
    });
    new cdk.CfnOutput(this, "PublicDns", {
      description:
        "Public DNS name (resolves to PublicIp; preferred over raw IP)",
      value: demoInstance.attrPublicDnsName,
    });
    new cdk.CfnOutput(this, "ShopUrl", {
      description:
        "Demo shop + console URL (Next.js; /shop, /connect, /enable, …)",
      value: cdk.Fn.sub("http://${DemoInstance.PublicDnsName}:3000/shop"),
    });
    new cdk.CfnOutput(this, "SsmConnectHint", {
      description: "Connect without SSH",
      value: cdk.Fn.sub(
        "aws ssm start-session --target ${DemoInstance} --region ${AWS::Region}",
      ),
    });
  }
}
