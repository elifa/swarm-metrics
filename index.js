"use strict";

const AWS = require("aws-sdk");
const MetricPublisher = require("./metric-publisher");

const child_process = require("child_process");

const CONFIGURATION = {
    "region": process.env['REGION'],
    "apiVersion": "2010-08-01"
};

const DIMENSIONS = [{
    "Name": "Stack",
    "Value": process.env['STACK_NAME']
}];

const UNITS = {
    "CPUUsage": "Percent",
    "MemUsed": "Bytes",
    "MemLimit": "Bytes",
    "MemPercent": "Percent",
    "NetworkRx": "Bytes/Second",
    "NetworkTx": "Bytes/Second",
    "BlockIORead": "Bytes/Second",
    "BlockIOWrite": "Bytes/Second"
};

const publisher = new MetricPublisher(AWS, CONFIGURATION, process.env['NAMESPACE'], {
    "disabled": false
});

function readMetrics() {
    return new Promise((resolve, reject) => {
        console.time("stats");

        const result = [];
        const execution = child_process.spawn("docker", [
            "stats",
            "--no-stream",
            "--format",
            "{{.ID}}\t{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"
        ]);

        execution.stdout.on("data", data => {
            console.debug(`stdout: ${data}`);
            result.push(data);
        });

        execution.stderr.on("data", data => {
            console.error(`stderr: ${data}`);
        });

        execution.on("close", code => {
            console.timeEnd("stats");

            if (code !== 0) {
                reject();
            } else {
                resolve(result);
            }
        });
    });
}

function parseServiceName(name) {
    return name.split(".")[0]
}

function biValue(rawValue) {
    const order = ["B", "kiB", "MiB", "GiB", "TiB", "PiB"];
    const parts = /^([\d\.]*)\s?([kmgtpKMGTP]i[Bb])$/.exec(rawValue);

    if (parts == null || parts.length < 3) {
        return 0;
    }

    return parseInt(parts[1]) * Math.pow(2, 10 * order.indexOf(parts[2]));
}

function byteValue(rawValue) {
    const order = ["B", "kB", "MB", "GB", "TB", "PB"];
    const parts = /^([\d.]*)s?([kmgtpKMGTP]?[Bb])$/.exec(rawValue);

    if (parts == null || parts.length < 3) {
        return 0;
    }

    return parseInt(parts[1]) * Math.pow(1024, order.indexOf(parts[2]));
}

function percentValue(value, total) {
    return parseFloat(total === 0 ? 0 : (value * 100 / total).toFixed(2));
}

function cpuValue(rawValue) {
    return parseFloat(rawValue.replace(/[ %]+/g, ""));
}

function memValue(rawValue) {
    const [used, limit] = rawValue.split("/").map(value => value.trim()).map(value => biValue(value));

    return [used, limit, percentValue(used, limit)];
}

function netValue(rawValue) {
    return rawValue.split("/").map(value => value.trim()).map(value => byteValue(value));
}

function blockValue(rawValue) {
    return rawValue.split("/").map(value => value.trim()).map(value => byteValue(value));
}

function parseLine(line) {
    return new Promise((resolve, reject) => {
        console.time("parse");

        const [id, name, cpu, mem, net, block] = line.split("\t").map(item => item.trim());
        const service = parseServiceName(name);

        const cpuUsage = cpuValue(cpu);
        const memUsage = memValue(mem);
        const netUsage = netValue(net);
        const blockUsage = blockValue(block);

        resolve({
            "Task": name,
            "Service": service,
            "Values": {
                "CPUUsage": cpuUsage,
                "MemUsed": memUsage[0],
                "MemLimit": memUsage[1],
                "MemPercent": memUsage[2],
                "NetworkTx": netUsage[0],
                "NetworkRx": netUsage[1],
                "BlockIORead": blockUsage[0],
                "BlockIOWrite": blockUsage[1]
            }
        });

        console.timeEnd("parse");
    });
}

function publishMetrics(result) {
    console.time("publish");

    for (const name in result.Values) {
        if (!result.Values.hasOwnProperty(name) || !UNITS.hasOwnProperty(name)) {
            continue;
        }

        publisher.publish({
            "metric": name,
            "value": result.Values[name],
            "unit": UNITS[name],
            "dimensions": DIMENSIONS.concat([{
                "Name": "Service",
                "Value": result.Service
            }])
        });

        publisher.publish({
            "metric": name,
            "value": result.Values[name],
            "unit": UNITS[name],
            "dimensions": DIMENSIONS.concat([{
                "Name": "TaskID",
                "Value": result.Task
            }])
        });
    }

    console.timeEnd("publish");
}

function updateMetrics() {
    console.log("Initiating metric update.");

    readMetrics().then(output => {
        return Promise.all(output.map(line => line.toString("utf-8").split("\n"))
            .reduce((a, b) => a.concat(b), [])
            .filter(line => line != null && line.length > 0)
            .map(line => parseLine(line).then(result => publishMetrics(result))))
    }).then(result => {
        console.log(`Sucessfully parsed and added ${result.length} metric sets to queue.`);

        return publisher.flush();
    }).then(result => {
        console.log(`Flushed metrics successfully in ${result.length} separate chunks.`);
    }).catch(error => {
        console.error(JSON.stringify(error));
    });
}

setInterval(updateMetrics, 1000 * parseInt(process.env['INTERVAL'] || 10));

