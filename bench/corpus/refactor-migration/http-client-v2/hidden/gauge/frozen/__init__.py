"""The frozen behavioural test suite for feedservice.

These tests describe what the service DOES, not how it is built: they drive the
public Application surface and the documented feedservice.testing helpers, and
they assert on reports, counters and error types. Nothing here imports the HTTP
client library, so the suite is expected to survive a change of client library
without a single edit.
"""
