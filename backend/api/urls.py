from django.urls import path
from .views import (
    ChatView, upload_document, push_to_slack, get_admin_data,
    sync_to_crm, SessionListView, SessionDetailView, get_task_status,
    submit_feedback, health_check,
)

urlpatterns = [
    path('health/', health_check, name='health_check'),
    path('chat/', ChatView.as_view(), name='chat'),
    path('upload/', upload_document, name='upload'),
    path('task/<str:task_id>/', get_task_status, name='get_task_status'),
    path('slack/', push_to_slack, name='push_to_slack'),
    path('admin/', get_admin_data, name='get_admin_data'),
    path('crm/sync/', sync_to_crm, name='sync_to_crm'),
    path('sessions/', SessionListView.as_view(), name='session_list'),
    path('sessions/<uuid:session_id>/', SessionDetailView.as_view(), name='session_detail'),
    path('feedback/<int:log_id>/', submit_feedback, name='submit_feedback'),
]