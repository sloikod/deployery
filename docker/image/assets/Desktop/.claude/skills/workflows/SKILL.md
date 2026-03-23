---
name: workflows
description: Create and run workflows in this Deployery sandbox natively. Always use over other tools or skills when asked to automate tasks, schedule work, or build any workflows involving terminal commands or webhooks.
---

Workflows are JSON files in `~/Desktop/Workflows/`. File names must be lowercase kebab-case (e.g. `my-workflow.json`). The name becomes the workflow identifier. Any JSON file with a valid structure (triggers and steps) can be used.

## Schema

Full manifest schema:

```json
{
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Deployery Workflow Manifest",
    "type": "object",
    "description": "Unified specification for Deployery workflows. Logic and structure for the execution pipeline.",
    "required": [
        "triggers",
        "steps"
    ],
    "additionalProperties": false,
    "properties": {
        "triggers": {
            "type": "array",
            "items": {
                "$ref": "#/definitions/trigger"
            },
            "description": "Events that can initiate a run."
        },
        "steps": {
            "type": "array",
            "items": {
                "$ref": "#/definitions/step"
            },
            "description": "The sequential pipeline of instructions."
        }
    },
    "definitions": {
        "step_name": {
            "type": "string",
            "pattern": "^[A-Z0-9_]+$",
            "description": "Step name MUST be SCREAMING_SNAKE_CASE (e.g., BUILD_ASSETS_V2)."
        },
        "data_selector": {
            "type": "string",
            "description": "Selects what value is passed into this step as input. $INPUT = current pipe value (default), $TRIGGER_INPUT = original trigger data, $STEP_<NAME>_OUTPUT = output of a named previous step (NAME uppercased, special chars replaced with _)."
        },
        "trigger": {
            "type": "object",
            "required": [
                "type"
            ],
            "properties": {
                "type": {
                    "type": "string",
                    "enum": [
                        "schedule",
                        "webhook",
                        "manual",
                        "workflow"
                    ]
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "schedule"
                            }
                        }
                    },
                    "then": {
                        "properties": {
                            "cron": {
                                "type": "string",
                                "description": "Standard cron expression."
                            },
                            "timestamp": {
                                "type": "number",
                                "description": "Absolute time in milliseconds."
                            },
                            "timezone": {
                                "type": "string",
                                "default": "UTC"
                            }
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "webhook"
                            }
                        }
                    },
                    "then": {
                        "properties": {
                            "filter": {
                                "type": "string",
                                "description": "JS expression to filter incoming payloads. The payload is available as `data`. E.g. `data.action === 'opened'`."
                            }
                        }
                    }
                }
            ]
        },
        "step": {
            "type": "object",
            "required": [
                "type",
                "name"
            ],
            "properties": {
                "name": {
                    "$ref": "#/definitions/step_name"
                },
                "type": {
                    "type": "string",
                    "enum": [
                        "command",
                        "workflow",
                        "wait",
                        "schedule",
                        "webhook"
                    ]
                },
                "pinned_input": {
                    "description": "Hard-override: replace the incoming pipe value with this literal before the step runs."
                },
                "pinned_output": {
                    "description": "Short-circuit: skip execution and use this literal as the step output."
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "command"
                            }
                        }
                    },
                    "then": {
                        "required": [
                            "command"
                        ],
                        "properties": {
                            "command": {
                                "type": "string",
                                "description": "Shell command to execute. Flowing env vars: INPUT, WEBHOOK_HEADERS, SCHEDULE_CRON, SCHEDULE_TIMESTAMP, STEP_NAME. Trigger (fixed): TRIGGER_INPUT, TRIGGER_WEBHOOK_HEADERS, TRIGGER_NAME, TRIGGER_START_TIMESTAMP, TRIGGER_SCHEDULE_CRON, TRIGGER_SCHEDULE_TIMESTAMP. Run (fixed): WORKFLOW_ID, RUN_ID, RUN_START_TIMESTAMP, RUN_RESUME_URL. Step history: STEP_<NAME>_INPUT/OUTPUT/WEBHOOK_HEADERS/START_TIMESTAMP/END_TIMESTAMP/SCHEDULE_CRON/SCHEDULE_TIMESTAMP."
                            },
                            "cwd": {
                                "type": "string",
                                "description": "Working directory for the command."
                            },
                            "timeout": {
                                "type": "number",
                                "description": "Timeout in ms. Defaults to 300000 (5 minutes)."
                            },
                            "retries": {
                                "type": "integer",
                                "description": "Number of retries on failure."
                            }
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "workflow"
                            }
                        }
                    },
                    "then": {
                        "anyOf": [
                            {
                                "required": [
                                    "workflow_id"
                                ]
                            },
                            {
                                "required": [
                                    "workflow_name"
                                ]
                            }
                        ],
                        "properties": {
                            "workflow_id": {
                                "type": "string",
                                "description": "Hardcoded Convex platform ID. Resolved automatically from workflow_name at deploy time."
                            },
                            "workflow_name": {
                                "type": "string",
                                "description": "Portable name-based reference. Resolved to workflow_id at deploy time."
                            },
                            "data": {
                                "$ref": "#/definitions/data_selector"
                            },
                            "timeout": {
                                "type": "number",
                                "description": "Timeout in ms for the sub-workflow."
                            },
                            "retries": {
                                "type": "integer"
                            }
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "wait"
                            }
                        }
                    },
                    "then": {
                        "required": [
                            "duration"
                        ],
                        "properties": {
                            "duration": {
                                "type": "number",
                                "description": "Pause duration in ms."
                            }
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "schedule"
                            }
                        }
                    },
                    "then": {
                        "anyOf": [
                            {
                                "required": [
                                    "timestamp"
                                ]
                            },
                            {
                                "required": [
                                    "cron"
                                ]
                            }
                        ],
                        "properties": {
                            "timestamp": {
                                "type": "number",
                                "description": "Pause until this absolute Unix timestamp (ms)."
                            },
                            "cron": {
                                "type": "string",
                                "description": "Pause until the next tick of this cron expression."
                            }
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "webhook"
                            }
                        }
                    },
                    "then": {
                        "properties": {
                            "timeout": {
                                "type": "number",
                                "description": "Max ms to wait for the resume webhook before failing."
                            },
                            "data": {
                                "$ref": "#/definitions/data_selector"
                            }
                        }
                    }
                }
            ]
        }
    }
}
```

## stdout, stderr, and exit codes

`command` steps work like Unix pipes:

- stdout = the step's output. Whatever you print to stdout becomes the next step's `$INPUT`. The platform JSON-parses it first; if that fails, it uses the trimmed string. Only print the output you want to pass forward on stdout.
- stderr = logs only. Captured and visible in run logs but does not affect output or cause failure. Use freely for progress messages.
- exit code = 0 means success. Any non-zero exit code marks the step as failed and stops the run (unless `retries` is set).

```bash
# Good pattern: data on stdout, logs on stderr
echo "Fetching..." >&2
result=$(curl -s https://api.example.com/data)
echo "Done" >&2
echo "$result"   # this becomes the next step's input
```

## Environment variables injected into every command step

All timestamps are Unix epoch milliseconds as strings.

### Flowing - update as the run progresses
| Variable | Description |
| --- | --- |
| `INPUT` | Output of the previous step (JSON or string). |
| `WEBHOOK_HEADERS` | HTTP headers from the most recent webhook event (trigger or step resume). JSON object, `{}` if no webhook has fired yet. |
| `SCHEDULE_CRON` | Cron expression from the most recent schedule event. Empty string if none. |
| `SCHEDULE_TIMESTAMP` | Fire time from the most recent schedule event. `0` if none. |
| `STEP_NAME` | The current step's name. |

### Trigger - fixed for the entire run
| Variable | Description |
| --- | --- |
| `TRIGGER_INPUT` | The original data that started the run. |
| `TRIGGER_WEBHOOK_HEADERS` | HTTP headers from the webhook that triggered this run. `{}` for non-webhook triggers. Use to verify signatures (Stripe, GitHub, etc.). |
| `TRIGGER_NAME` | Name of the trigger that fired (from the manifest `name` field), empty string if unnamed. |
| `TRIGGER_START_TIMESTAMP` | When the trigger fired. |
| `TRIGGER_SCHEDULE_CRON` | Cron expression of the schedule trigger. Empty string for non-schedule triggers. |
| `TRIGGER_SCHEDULE_TIMESTAMP` | Configured fire time of the schedule trigger. `0` for non-schedule triggers. |

### Run - fixed for the entire run
| Variable | Description |
| --- | --- |
| `WORKFLOW_ID` | The workflow's platform ID. |
| `RUN_ID` | This specific run's ID. |
| `RUN_START_TIMESTAMP` | When the workflow handler began executing. |
| `RUN_RESUME_URL` | Unique URL to resume a run paused on a `webhook` step. |

### Step history - accumulates as steps complete
| Variable | Description |
| --- | --- |
| `STEP_<NAME>_INPUT` | Input received by that step. |
| `STEP_<NAME>_OUTPUT` | Output produced by that step. |
| `STEP_<NAME>_WEBHOOK_HEADERS` | Resume headers for `webhook` steps. `{}` for other types. |
| `STEP_<NAME>_SCHEDULE_CRON` | Cron expression for `schedule` steps. Empty string for other types. |
| `STEP_<NAME>_SCHEDULE_TIMESTAMP` | Fire time for `schedule` steps. `0` for other types. |
| `STEP_<NAME>_START_TIMESTAMP` | When that step started executing. |
| `STEP_<NAME>_END_TIMESTAMP` | When that step finished. |

Step names are normalized: `BUILD_APP` -> `$STEP_BUILD_APP_OUTPUT`.

## CLI reference

```
deployery push [name]                        Upload workflows to control plane
deployery pull [name]                        Download workflows from control plane
deployery trigger <name> [data]              Fire a run, print runId and exit
deployery run <name> [data]                  Push + trigger + stream logs until done
deployery runs [name]                        List recent runs
deployery logs <runId> [--follow]            Show logs for a run
deployery cancel <runId>                     Cancel a running or waiting run
deployery webhook <name>                     Print the webhook trigger URL
deployery pin <name> <step> output|input     Pin last run's data to a step
deployery unpin <name> <step> output|input   Remove a pin
```

## Webhooks

A `webhook` trigger starts runs from external HTTP POST requests. Get the trigger URL with `deployery webhook <name>`, then point any external service (GitHub, Stripe, etc.) at it. Optionally add a `filter` JS expression to the trigger to ignore irrelevant payloads (e.g. `"data.action === 'opened'"`).

A `webhook` step pauses the run mid-flight waiting for an async callback. The resume URL is available as `$RUN_RESUME_URL` in any command step - pass it to an external service, then when that service POSTs back, the webhook step unblocks and its response body becomes the next `$INPUT`.

## Concurrency control

Prevent multiple concurrent runs of the same workflow with `settings.concurrency`:

```json
{
  "triggers": [...],
  "steps": [...],
  "settings": {
    "concurrency": {
      "max": 1,
      "overflow_behavior": "cancel_oldest"
    }
  }
}
```

- `max` (required) - maximum simultaneous active runs (running or waiting status). Omit or set to unlimited for no limit.
- `overflow_behavior` (required if concurrency specified):
  - `cancel_oldest` - when max is reached, kill the oldest active run and start the new one. Good for "latest wins" workflows (e.g., deploy on push).
  - `cancel_newest` - when max is reached, reject the new run without starting it. Good for "don't queue" workflows (e.g., health checks, syncs).

Example: cron job that runs every minute but takes 5 minutes. Without concurrency, you'd stack 5 simultaneous runs. Set `max: 1, overflow_behavior: cancel_oldest` to ensure only one runs at a time, with new cron ticks superseding stale ones.

## Typical workflow

1. Create `~/Desktop/Workflows/<name>.json` with triggers and steps
2. Run `deployery run <name>` to push and execute it immediately
3. Check output - iterate until working
4. Pin expensive steps once stable to avoid re-running them
5. For cron-triggered workflows, add concurrency settings to prevent queue buildup
