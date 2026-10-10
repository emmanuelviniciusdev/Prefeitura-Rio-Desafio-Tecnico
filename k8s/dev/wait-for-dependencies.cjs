'use strict';

// Runs in the API image before the process serves traffic. Module lookup
// starts at /app, where node_modules lives. Errors must not include
// connection strings: those carry credentials.

const deadline =
  Date.now() + Number(process.env.WAIT_TIMEOUT_SECONDS || 300) * 1000;

const targets = new Set(
  (process.env.WAIT_FOR || 'mysql,redis,mongodb,rabbitmq')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timedOut() {
  return Date.now() > deadline;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('timeout');
      error.code = 'ETIMEDOUT';
      reject(error);
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function untilReady(name, probe) {
  for (;;) {
    if (timedOut()) {
      throw new Error(`${name} wait timed out`);
    }

    try {
      await withTimeout(probe(), 5000);
      console.log(`${name} ready`);
      return;
    } catch (error) {
      const code = error && error.code ? String(error.code) : 'unavailable';
      console.log(`${name} not ready (${code})`);
      await sleep(2000);
    }
  }
}

async function waitForMysql() {
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectTimeout: 2000,
  });

  try {
    await connection.query('SELECT 1');
  } finally {
    await connection.end();
  }
}

async function waitForRedis() {
  const Redis = require('ioredis');
  const client = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  client.on('error', () => {});

  try {
    await client.connect();
    const pong = await client.ping();
    if (pong !== 'PONG') {
      throw new Error('redis ping failed');
    }
  } finally {
    client.disconnect();
  }
}

async function waitForMongodb() {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 2000,
  });

  try {
    await client.db(process.env.MONGODB_DATABASE).command({ ping: 1 });
  } finally {
    await client.close();
  }
}

async function waitForRabbitmq() {
  const amqp = require('amqplib');
  const connection = await amqp.connect(process.env.RABBITMQ_URL, {
    timeout: 2000,
  });
  await connection.close();
}

const probes = {
  mysql: waitForMysql,
  redis: waitForRedis,
  mongodb: waitForMongodb,
  rabbitmq: waitForRabbitmq,
};

async function main() {
  for (const name of Object.keys(probes)) {
    if (!targets.has(name)) {
      continue;
    }

    await untilReady(name, probes[name]);
  }
}

main().catch((error) => {
  const message =
    error && error.message ? String(error.message) : 'wait failed';
  // Connection failures from the drivers can echo the URI.
  if (message.includes('://') || message.includes('@')) {
    console.error('wait failed');
  } else {
    console.error(message);
  }
  process.exit(1);
});
