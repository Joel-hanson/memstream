/** Memstream Lambda worker stack — parameterized CFN (Enable / deploy-lambda). */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";

export class MemstreamLambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.templateOptions.description =
      "Memstream Lambda worker — S3 CDC ObjectCreated → embed → Cockroach memory. " +
      "Shop/console stay local. Uses an existing CDC bucket (notification wired by deploy). " +
      "DB URLs live in Secrets Manager (ConfigSecretArn), not in CFN parameters.";

    const cdcS3Bucket = new cdk.CfnParameter(this, "CdcS3Bucket", {
      type: "String",
      description: "Existing S3 bucket used for CDC (and the Lambda zip).",
      allowedPattern: "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$",
    });

    const cdcS3Prefix = new cdk.CfnParameter(this, "CdcS3Prefix", {
      type: "String",
      default: "cdc/",
      description: "Prefix the changefeed writes under.",
    });

    const deployObjectKey = new cdk.CfnParameter(this, "DeployObjectKey", {
      type: "String",
      default: "deploy/memstream-lambda.zip",
      description: "Object key for the Lambda deployment package.",
    });

    const configSecretArn = new cdk.CfnParameter(this, "ConfigSecretArn", {
      type: "String",
      default: "",
      description:
        "Secrets Manager ARN for JSON {DATABASE_URL, MEMSTREAM_DATABASE_URL, MEMSTREAM_SECRETS_KEY}.",
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

    const memstreamConnectionId = new cdk.CfnParameter(
      this,
      "MemstreamConnectionId",
      {
        type: "String",
        default: "",
        description: "Optional connection UUID for CDC cursor scope.",
      },
    );

    const bedrockEmbedModel = new cdk.CfnParameter(this, "BedrockEmbedModel", {
      type: "String",
      default: "amazon.titan-embed-text-v2:0",
    });

    const memoryProfile = new cdk.CfnParameter(this, "MemoryProfile", {
      type: "String",
      default: "commerce",
      description: "Profile id (or legacy path). Loaded from memstream_profiles.",
    });

    const hasConfigSecret = new cdk.CfnCondition(this, "HasConfigSecret", {
      expression: cdk.Fn.conditionNot(
        cdk.Fn.conditionEquals(configSecretArn.valueAsString, ""),
      ),
    });

    const workerRole = new iam.CfnRole(this, "WorkerRole", {
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      },
      managedPolicyArns: [
        "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
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
                Resource: cdk.Fn.sub("arn:aws:s3:::${CdcS3Bucket}", {
                  CdcS3Bucket: cdcS3Bucket.valueAsString,
                }),
              },
              {
                Sid: "ReadCdcAndDeploy",
                Effect: "Allow",
                Action: ["s3:GetObject"],
                Resource: [
                  cdk.Fn.sub("arn:aws:s3:::${CdcS3Bucket}/${CdcS3Prefix}*", {
                    CdcS3Bucket: cdcS3Bucket.valueAsString,
                    CdcS3Prefix: cdcS3Prefix.valueAsString,
                  }),
                  cdk.Fn.sub("arn:aws:s3:::${CdcS3Bucket}/${DeployObjectKey}", {
                    CdcS3Bucket: cdcS3Bucket.valueAsString,
                    DeployObjectKey: deployObjectKey.valueAsString,
                  }),
                ],
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

    const workerFunction = new lambda.CfnFunction(this, "WorkerFunction", {
      functionName: cdk.Fn.sub("${AWS::StackName}-worker"),
      description: "Memstream S3 CDC → agent memory",
      runtime: "nodejs20.x",
      handler: "index.handler",
      role: workerRole.attrArn,
      timeout: 60,
      memorySize: 512,
      code: {
        s3Bucket: cdcS3Bucket.valueAsString,
        s3Key: deployObjectKey.valueAsString,
      },
      environment: {
        variables: {
          CONFIG_SECRET_ARN: configSecretArn.valueAsString,
          DATABASE_URL: databaseUrl.valueAsString,
          MEMSTREAM_DATABASE_URL: memstreamDatabaseUrl.valueAsString,
          MEMSTREAM_CONNECTION_ID: memstreamConnectionId.valueAsString,
          CDC_S3_BUCKET: cdcS3Bucket.valueAsString,
          CDC_S3_PREFIX: cdcS3Prefix.valueAsString,
          BEDROCK_EMBED_MODEL: bedrockEmbedModel.valueAsString,
          MEMORY_PROFILE: memoryProfile.valueAsString,
          MEMSTREAM_EMBEDDER: "bedrock",
          MEMSTREAM_STORE: "cockroach",
          MEMSTREAM_SOURCE: "s3",
          PGSSLROOTCERT: "/var/task/certs/root.crt",
        },
      },
    });

    new lambda.CfnPermission(this, "S3InvokePermission", {
      functionName: workerFunction.ref,
      action: "lambda:InvokeFunction",
      principal: "s3.amazonaws.com",
      sourceAccount: cdk.Aws.ACCOUNT_ID,
      sourceArn: cdk.Fn.sub("arn:aws:s3:::${CdcS3Bucket}", {
        CdcS3Bucket: cdcS3Bucket.valueAsString,
      }),
    });

    new cdk.CfnOutput(this, "FunctionName", {
      description: "Lambda function name",
      value: workerFunction.ref,
    });
    new cdk.CfnOutput(this, "FunctionArn", {
      description: "Lambda function ARN (for S3 notification)",
      value: workerFunction.attrArn,
    });
    new cdk.CfnOutput(this, "RoleArn", {
      description: "Worker IAM role",
      value: workerRole.attrArn,
    });
  }
}
