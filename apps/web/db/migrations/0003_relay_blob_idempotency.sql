ALTER TABLE relay_encrypted_blobs
  ADD CONSTRAINT relay_encrypted_blobs_envelope_blob_id_unique
  UNIQUE (envelope_blob_id);
