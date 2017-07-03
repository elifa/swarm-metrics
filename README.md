# swarm-metrics
Metric publisher for AWS that publishes metrics to CloudWatch based on data from `docker stats`.

## Example
`docker run -d -e REGION='eu-west-1' -e STACK_NAME='MyStack' -e INSTANCE_NAME='i-123324' -v /usr/bin/docker:/usr/bin/docker:ro -v /var/run/docker.sock:/var/run/docker.sock elifa/swarm-metrics`