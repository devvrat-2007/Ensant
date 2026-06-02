from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0004_add_is_agentic_to_auditlog'),
    ]

    operations = [
        migrations.AddField(
            model_name='auditlog',
            name='feedback_positive',
            field=models.BooleanField(null=True, blank=True, default=None),
        ),
        migrations.AddField(
            model_name='auditlog',
            name='feedback_rating',
            field=models.PositiveSmallIntegerField(
                null=True, blank=True, default=None,
                help_text='1 (very poor) – 5 (excellent). Null means no rating given.'
            ),
        ),
        migrations.AddField(
            model_name='auditlog',
            name='feedback_comment',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='auditlog',
            name='context_chunks',
            field=models.JSONField(
                default=list, blank=True,
                help_text='Ordered list of RAG chunks used to generate this response.'
            ),
        ),
        migrations.AddField(
            model_name='auditlog',
            name='feedback_at',
            field=models.DateTimeField(null=True, blank=True, default=None),
        ),
    ]
