# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.

.PHONY: build lint test test-core test-agent test-all dev install uninstall pack clean

build:
	npm run build

lint:
	npm run lint

test: test-core

test-core:
	npm run test:core

test-agent:
	npm run test:agent

test-all:
	npm run test:all

dev:
	npm run dev

install:
	npm run install:local

uninstall:
	npm run uninstall:local

pack:
	npm run pack

clean:
	rm -rf dist build
