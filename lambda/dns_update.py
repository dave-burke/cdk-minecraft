import os

import boto3


def handler(event, context):
    print("## ENVIRONMENT VARIABLES")
    print(os.environ)
    print("## EVENT")
    print(event)

    try:
        instance_id = event["detail"]["EC2InstanceId"]
    except KeyError:
        raise ValueError(f"Unexpected event structure: {event}")

    print(f"Getting data for EC2 instance {instance_id}")
    new_instance = boto3.resource("ec2").Instance(instance_id)

    hosted_zone_id = os.environ["HostedZoneId"]
    record_name = os.environ["RecordName"]

    new_instance.wait_until_running()
    new_instance.reload()
    public_ip = new_instance.public_ip_address

    if not public_ip:
        raise Exception("Instance has no public IP yet")

    public_ip = new_instance.public_ip_address

    print(f"Updating {record_name} to direct to {public_ip} in {hosted_zone_id}")

    route53 = boto3.client("route53")

    response = route53.change_resource_record_sets(
        HostedZoneId=hosted_zone_id,
        ChangeBatch={
            "Comment": "updating",
            "Changes": [
                {
                    "Action": "UPSERT",
                    "ResourceRecordSet": {
                        "Name": record_name,
                        "Type": "A",
                        "TTL": 60,
                        "ResourceRecords": [
                            {"Value": public_ip},
                        ],
                    },
                },
            ],
        },
    )

    print("Route53 change submitted:", response["ChangeInfo"]["Id"])
