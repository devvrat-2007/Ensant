import os
from django.core.wsgi import get_wsgi_application

# Make sure this points to core.settings!
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

# 👇 THE HACKATHON FREE-TIER AUTO-MIGRATE HACK 👇
import django
from django.core.management import call_command
django.setup()
try:
    print("🚀 Running automatic database migrations...")
    call_command('migrate', interactive=False)
    print("✅ Database migrations completed successfully!")
except Exception as e:
    print(f"❌ Auto-migration failed: {e}")
# 👆 --------------------------------------- 👆

application = get_wsgi_application()
