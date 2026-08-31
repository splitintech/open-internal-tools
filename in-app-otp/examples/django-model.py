from django.db import models


class InAppOtpChallenge(models.Model):
    STATUS_CHOICES = [
        ("active", "Active"),
        ("verified", "Verified"),
        ("expired", "Expired"),
        ("cancelled", "Cancelled"),
        ("locked", "Locked"),
    ]

    id = models.UUIDField(primary_key=True)
    tenant_id = models.CharField(max_length=128)
    purpose = models.CharField(max_length=128)
    subject_type = models.CharField(max_length=64)
    subject_id = models.CharField(max_length=128)
    viewer_user_id = models.CharField(max_length=128)
    verifier_user_id = models.CharField(max_length=128)
    code_hash = models.TextField()
    status = models.CharField(max_length=32, choices=STATUS_CHOICES)
    attempt_count = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=5)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["tenant_id", "purpose", "subject_type", "subject_id", "status"]),
            models.Index(fields=["viewer_user_id", "status"]),
            models.Index(fields=["verifier_user_id", "status"]),
        ]

# Verification should run under transaction.atomic() with select_for_update().
# Rickshaw trip-start integration point:
# driver_trip_transition(..., action="start") verifies purpose="rickshaw.trip.start"
# before transition_trip_state(trip, TripStatus.STARTED, ...).
