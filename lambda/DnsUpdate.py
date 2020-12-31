
import boto3
import os

def handler(event, context):
    new_instance = boto3.resource('ec2').Instance(event['detail']['EC2InstanceId'])
    boto3.client('route53').change_resource_record_sets(
        HostedZoneId= os.environ['HostedZoneId'],
        ChangeBatch={
            'Comment': 'updating',
            'Changes': [
                {
                    'Action': 'UPSERT',
                    'ResourceRecordSet': {
                        'Name': os.environ['RecordName'],
                        'Type': 'A',
                        'TTL': 60,
                        'ResourceRecords': [
                            {
                                'Value': new_instance.public_ip_address
                            },
                        ]
                    }
                },
            ]
        })
