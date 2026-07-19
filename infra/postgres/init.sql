-- Development-only init: create the integration-test database alongside the
-- main development database. Runs once on first postgres volume creation.
CREATE DATABASE openvoice_test OWNER openvoice;
