# Ingestion Package

This package owns the front door for Bidwright project packages:

- unzip the customer package
- classify files into specs, RFQs, drawings, addenda, schedules, and estimating books
- chunk extracted content
- store and retrieve chunks through a retrieval abstraction

It is intentionally extractor-friendly so better PDF/OCR/CAD processors can be swapped in later without changing the contract.
