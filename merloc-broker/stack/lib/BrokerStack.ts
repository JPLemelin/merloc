import * as cdk from '@aws-cdk/core';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations';
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';
import { Runtime } from '@aws-cdk/aws-lambda';
import { Duration } from '@aws-cdk/core';
import { Effect, PolicyStatement } from '@aws-cdk/aws-iam';

const DEFAULT_DEBUG_ENABLE = 'true';
const DEFAULT_BROKER_CONNECTION_HANDLER_FUNCTION_MEMORY_SIZE: string = '1024';
const DEFAULT_BROKER_CONNECTION_HANDLER_FUNCTION_TIMEOUT: string = '30';
const DEFAULT_BROKER_MESSAGE_HANDLER_FUNCTION_MEMORY_SIZE: string = '1024';
const DEFAULT_BROKER_MESSAGE_HANDLER_FUNCTION_TIMEOUT: string = '30';
const DEFAULT_BROKER_WS_API_STAGE_NAME = 'dev';

export class BrokerStack extends cdk.Stack {

  private readonly clientConnectionsTable: dynamodb.Table;
  private readonly gatekeeperConnectionsTable: dynamodb.Table;
  private readonly clientGatekeeperConnectionPairsTable: dynamodb.Table;
  private readonly brokerConnectionHandlerFunction: NodejsFunction;
  private readonly brokerMessageHandlerFunction: NodejsFunction;
  private readonly brokerWebSocketAPI: apigwv2.WebSocketApi;
  private readonly brokerWebSocketAPIStage: apigwv2.WebSocketStage;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create client connections table
    this.clientConnectionsTable = new dynamodb.Table(this, `merloc-client-connections`, {
      tableName: `merloc-client-connections`,
      partitionKey: {
        name: 'name',
        type: dynamodb.AttributeType.STRING,
      },
      timeToLiveAttribute: 'expireTimestamp',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new cdk.CfnOutput(this, `merloc-client-connections-table-name`, {
      value: this.clientConnectionsTable.tableName,
      exportName: `merloc-client-connections-table-name`,
    });
    new cdk.CfnOutput(this, `merloc-client-connections-table-arn`, {
      value: this.clientConnectionsTable.tableArn,
      exportName: `merloc-client-connections-table-arn`,
    });

    // Create gatekeeper connections table
    this.gatekeeperConnectionsTable = new dynamodb.Table(this, `merloc-gatekeeper-connections`, {
      tableName: `merloc-gatekeeper-connections`,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      timeToLiveAttribute: 'expireTimestamp',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new cdk.CfnOutput(this, `merloc-gatekeeper-connections-table-name`, {
      value: this.gatekeeperConnectionsTable.tableName,
      exportName: `merloc-gatekeeper-connections-table-name`,
    });
    new cdk.CfnOutput(this, `merloc-gatekeeper-connections-table-arn`, {
      value: this.gatekeeperConnectionsTable.tableArn,
      exportName: `merloc-gatekeeper-connections-table-arn`,
    });

    // Create client-gatekeeper connection pairs table
    this.clientGatekeeperConnectionPairsTable = new dynamodb.Table(this, `merloc-client-gatekeeper-connection-pairs`, {
      tableName: `merloc-client-gatekeeper-connection-pairs`,
      partitionKey: {
        name: 'clientConnectionId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gatekeeperConnectionId',
        type: dynamodb.AttributeType.STRING,
      },
      timeToLiveAttribute: 'expireTimestamp',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new cdk.CfnOutput(this, `merloc-client-gatekeeper-connection-pairs-table-name`, {
      value: this.clientGatekeeperConnectionPairsTable.tableName,
      exportName: `merloc-client-gatekeeper-connection-pairs-table-name`,
    });
    new cdk.CfnOutput(this, `merloc-client-gatekeeper-connection-pairs-table-arn`, {
      value: this.clientGatekeeperConnectionPairsTable.tableArn,
      exportName: `merloc-client-gatekeeper-connection-pairs-table-arn`,
    });

    // Create broker connection handler function
    this.brokerConnectionHandlerFunction = new NodejsFunction(this, 'merloc-broker-connection-handler', {
      entry: `${__dirname}/../../src/lambdas/ConnectionHandler.ts`,
      depsLockFilePath: `${__dirname}/../../src/package-lock.json`,
      bundling: {
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string) {
            return [
              `cd ${inputDir}`,
              'npm install',
            ]
          },
          beforeInstall() {
            return []
          },
          afterBundling() {
            return []
          }
        }
      },
      functionName: 'merloc-broker-connection-handler',
      handler: 'handler',
      runtime: Runtime.NODEJS_16_X,
      timeout: Duration.seconds(parseInt(
          process.env.MERLOC_BROKER_CONNECTION_HANDLER_FUNCTION_TIMEOUT
          || DEFAULT_BROKER_CONNECTION_HANDLER_FUNCTION_TIMEOUT)),
      memorySize: parseInt(
          process.env.MERLOC_BROKER_CONNECTION_HANDLER_FUNCTION_MEMORY_SIZE
          || DEFAULT_BROKER_CONNECTION_HANDLER_FUNCTION_MEMORY_SIZE),
      environment: {
        MERLOC_DEBUG_ENABLE: process.env.MERLOC_DEBUG_ENABLE || DEFAULT_DEBUG_ENABLE,
        MERLOC_CLIENT_CONNECTIONS_TABLE_NAME: this.clientConnectionsTable.tableName,
        MERLOC_GATEKEEPER_CONNECTIONS_TABLE_NAME: this.gatekeeperConnectionsTable.tableName,
        MERLOC_CLIENT_GATEKEEPER_CONNECTION_PAIRS_TABLE_NAME: this.clientGatekeeperConnectionPairsTable.tableName,
      },
    });

    // Give access to broker connection handler function for client and gatekeeper connections and pairs tables
    this.clientConnectionsTable.grantReadWriteData(this.brokerConnectionHandlerFunction);
    this.gatekeeperConnectionsTable.grantReadWriteData(this.brokerConnectionHandlerFunction);
    this.clientGatekeeperConnectionPairsTable.grantReadWriteData(this.brokerConnectionHandlerFunction);

    // Create broker message handler function
    this.brokerMessageHandlerFunction = new NodejsFunction(this, 'merloc-broker-message-handler', {
      entry: `${__dirname}/../../src/lambdas/MessageHandler.ts`,
      depsLockFilePath: `${__dirname}/../../src/package-lock.json`,
      bundling: {
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string) {
            return [
              `cd ${inputDir}`,
              'npm install',
            ]
          },
          beforeInstall() {
            return []
          },
          afterBundling() {
            return []
          }
        }
      },
      functionName: 'merloc-broker-message-handler',
      handler: 'handler',
      runtime: Runtime.NODEJS_16_X,
      timeout: Duration.seconds(parseInt(
          process.env.MERLOC_BROKER_MESSAGE_HANDLER_FUNCTION_TIMEOUT
          || DEFAULT_BROKER_MESSAGE_HANDLER_FUNCTION_TIMEOUT)),
      memorySize: parseInt(
          process.env.MERLOC_BROKER_MESSAGE_HANDLER_FUNCTION_MEMORY_SIZE
          || DEFAULT_BROKER_MESSAGE_HANDLER_FUNCTION_MEMORY_SIZE),
      environment: {
        MERLOC_DEBUG_ENABLE: process.env.MERLOC_DEBUG_ENABLE || DEFAULT_DEBUG_ENABLE,
        MERLOC_CLIENT_CONNECTIONS_TABLE_NAME: this.clientConnectionsTable.tableName,
        MERLOC_GATEKEEPER_CONNECTIONS_TABLE_NAME: this.gatekeeperConnectionsTable.tableName,
        MERLOC_CLIENT_GATEKEEPER_CONNECTION_PAIRS_TABLE_NAME: this.clientGatekeeperConnectionPairsTable.tableName,
      },
    });

    // Give access to broker message handler function for client and gatekeeper connections and pairs table
    this.clientConnectionsTable.grantReadWriteData(this.brokerMessageHandlerFunction);
    this.gatekeeperConnectionsTable.grantReadWriteData(this.brokerMessageHandlerFunction);
    this.clientGatekeeperConnectionPairsTable.grantReadWriteData(this.brokerMessageHandlerFunction);

    // Create broker websocket API
    this.brokerWebSocketAPI = new apigwv2.WebSocketApi(this, 'merloc-broker-ws-api', {
      apiName: 'merloc-broker-ws-api',
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('connectionIntegration', this.brokerConnectionHandlerFunction),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('disconnectIntegration', this.brokerConnectionHandlerFunction),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration('defaultIntegration', this.brokerMessageHandlerFunction),
      },
      routeSelectionExpression: '$request.body.type',
    });
    new cdk.CfnOutput(this, `merloc-broker-ws-api-name`, {
      value: this.brokerWebSocketAPI.webSocketApiName || '',
      exportName: `merloc-broker-ws-api-name`,
    });
    new cdk.CfnOutput(this, `merloc-broker-ws-api-id`, {
      value: this.brokerWebSocketAPI.apiId,
      exportName: `merloc-broker-ws-api-id`,
    });
    new cdk.CfnOutput(this, `merloc-broker-ws-api-endpoint`, {
      value: this.brokerWebSocketAPI.apiEndpoint,
      exportName: `merloc-broker-ws-api-endpoint`,
    });

    // Create broker websocket API stage
    this.brokerWebSocketAPIStage = new apigwv2.WebSocketStage(this, 'merloc-broker-ws-api-stage', {
      webSocketApi: this.brokerWebSocketAPI,
      stageName: process.env.MERLOC_BROKER_WS_API_STAGE_NAME || DEFAULT_BROKER_WS_API_STAGE_NAME,
      autoDeploy: true,
    });
    new cdk.CfnOutput(this, `merloc-broker-ws-api-stage-name`, {
      value: this.brokerWebSocketAPIStage.stageName,
      exportName: `merloc-broker-ws-api-stage-name`,
    });
    new cdk.CfnOutput(this, `merloc-broker-ws-api-stage-url`, {
      value: this.brokerWebSocketAPIStage.url,
      exportName: `merloc-broker-ws-api-stage-url`,
    });
    new cdk.CfnOutput(this, `merloc-broker-ws-api-stage-callback-url`, {
      value: this.brokerWebSocketAPIStage.callbackUrl,
      exportName: `merloc-broker-ws-api-stage-callback-url`,
    });

    // Create policy to allow Lambda function to use @connections API of API Gateway
    const allowConnectionManagementOnApiGatewayPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${this.brokerWebSocketAPI.apiId}/${this.brokerWebSocketAPIStage.stageName}/*`,
      ],
      actions: ['execute-api:ManageConnections'],
    });

    // Give access to broker connection and message handler functions for broker API management
    this.brokerConnectionHandlerFunction.addToRolePolicy(allowConnectionManagementOnApiGatewayPolicy);
    this.brokerMessageHandlerFunction.addToRolePolicy(allowConnectionManagementOnApiGatewayPolicy);
  }

}
