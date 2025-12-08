# Langfuse User Feedback Setup Guide

This guide explains how to configure your LangGraph Python backend to work with the Langfuse user feedback feature in this UI.

## The Problem

The UI needs to know which Langfuse trace ID corresponds to each AI message so that when users provide feedback (👍/👎), it can be linked to the correct trace in Langfuse.

## The Solution

Your backend needs to:
1. Use Langfuse tracing for your agent
2. Get the trace ID from Langfuse
3. Return that trace ID as the message ID to the frontend

## Backend Implementation

### Option 1: Using `@observe` Decorator (Recommended)

```python
from langfuse.decorators import observe, get_current_trace_id
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

@observe()  # This creates a Langfuse trace
def run_agent(user_input: str):
    # Your agent setup
    llm = ChatOpenAI(model="gpt-4")
    agent = create_react_agent(model=llm, tools=[...])
    
    # Get the current Langfuse trace ID
    trace_id = get_current_trace_id()
    
    # Run your agent
    response = agent.invoke({
        "messages": [{"role": "user", "content": user_input}]
    })
    
    # IMPORTANT: Return the trace_id as the message ID
    return {
        "id": trace_id,  # This is what the UI will use for feedback
        "content": response["messages"][-1].content,
        "type": "ai"
    }
```

### Option 2: Using CallbackHandler

```python
from langfuse.callback import CallbackHandler

# Initialize the handler
langfuse_handler = CallbackHandler(
    public_key="pk-lf-...",
    secret_key="sk-lf-..."
)

# Use it with your agent
response = agent.invoke(
    {"messages": [{"role": "user", "content": user_input}]},
    config={"callbacks": [langfuse_handler]}
)

# Get the trace ID
trace_id = langfuse_handler.get_trace_id()

# Return with trace_id as message ID
return {
    "id": trace_id,
    "content": response["messages"][-1].content,
    "type": "ai"
}
```

## Frontend Configuration

Set these environment variables in your `.env.local`:

```env
NEXT_PUBLIC_LANGFUSE_PUBLIC_KEY="pk-lf-xxxx"
NEXT_PUBLIC_LANGFUSE_HOST="https://cloud.langfuse.com"  # Optional
```

## How It Works

```
┌─────────────┐                    ┌─────────────┐                    ┌─────────────┐
│   Backend   │                    │  Frontend   │                    │  Langfuse   │
│  (Python)   │                    │   (React)   │                    │             │
└──────┬──────┘                    └──────┬──────┘                    └──────┬──────┘
       │                                  │                                   │
       │ 1. Run agent with                │                                   │
       │    @observe decorator            │                                   │
       ├──────────────────────────────────┼──────────────────────────────────>│
       │                                  │         Create trace              │
       │                                  │                                   │
       │ 2. Get trace_id                  │                                   │
       │<─────────────────────────────────┼───────────────────────────────────┤
       │                                  │                                   │
       │ 3. Return message with           │                                   │
       │    trace_id as message.id        │                                   │
       ├─────────────────────────────────>│                                   │
       │                                  │                                   │
       │                                  │ 4. User clicks 👍 or 👎          │
       │                                  │                                   │
       │                                  │ 5. Send feedback with trace_id    │
       │                                  ├──────────────────────────────────>│
       │                                  │                                   │
       │                                  │         Score recorded            │
       │                                  │<──────────────────────────────────┤
```

## Testing

1. Start your backend with Langfuse tracing enabled
2. Send a message through the UI
3. Check the browser console - you should see the message ID (which is the trace ID)
4. Click the feedback buttons on an AI response
5. Go to your Langfuse dashboard - you should see:
   - The trace for the agent execution
   - A score named "user-feedback" attached to that trace

## Troubleshooting

**Feedback not appearing in Langfuse:**
- Check that `NEXT_PUBLIC_LANGFUSE_PUBLIC_KEY` is set correctly
- Check the browser console for errors
- Verify that `message.id` in the frontend contains the Langfuse trace ID

**Trace ID is null or undefined:**
- Make sure you're using the `@observe` decorator or CallbackHandler in your backend
- Check that `get_current_trace_id()` is being called within the observed function
- Ensure Langfuse SDK is properly initialized with public and secret keys

## Links

- [Langfuse Python SDK Docs](https://langfuse.com/docs/sdk/python)
- [Langfuse LangGraph Integration](https://langfuse.com/docs/integrations/langchain/langgraph)
- [Langfuse User Feedback Guide](https://langfuse.com/docs/observability/features/user-feedback)
