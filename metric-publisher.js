"use strict";

const assert = require("assert");

class MetricPublisher {
    constructor(AWS, config, namespace, options) {
        assert(AWS, "AWS required");
        assert(typeof namespace === "string", "namespace required and must be string");
        const {disabled} = options || {};
        this._cloudWatch = new AWS.CloudWatch(config);
        this._disabled = disabled;
        this._namespace = namespace;
        this._statQueue = [];
    }

    publish({
                metric,
                value,
                unit,
                dimensions,
                immediate
            }) {
        if (!immediate) {
            return this._queue({
                metric,
                value,
                unit,
                dimensions,
                timestamp: new Date(),
            });
        }

        return this._send([{
            metric,
            value,
            unit,
            dimensions,
            timestamp: new Date(),
        }]);
    }

    flush() {
        const promise = this._send(this._statQueue.slice(0));
        this._statQueue.splice(0);
        return promise;
    }

    _queue(params) {
        this._statQueue.push(params);
        return Promise.resolve({});
    }

    _send(items) {
        if (this._disabled || items.length <= 0) {
            return "Nothing to synchronize.";
        }

        const limit = 20;
        return Promise.all([...Array(Math.ceil(items.length / limit)).keys()].map((x, i) => items.slice(i * limit, i * limit + limit)).map(chunk => {
            const metrics = chunk.map(item => {
                let {
                    metric,
                    value,
                    unit,
                    dimensions,
                    timestamp
                } = item;

                unit = unit || "None";
                dimensions = dimensions || [];

                assert(typeof metric === "string", "params.metric required and must be string");
                assert(typeof value === "number", "params.value required and must be number");

                return {
                    MetricName: metric,
                    Dimensions: dimensions,
                    Timestamp: timestamp,
                    Unit: unit,
                    Value: value
                };
            });

            const params = {
                MetricData: metrics,
                Namespace: this._namespace
            };

            return this._cloudWatch
                .putMetricData(params)
                .promise();
        }));
    }
}

module.exports = MetricPublisher;