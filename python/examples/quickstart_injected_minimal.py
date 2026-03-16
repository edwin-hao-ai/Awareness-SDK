import os

from memory_cloud import bootstrap_openai_injected_session


def main() -> None:
    owner_id = os.getenv("AWARENESS_OWNER_ID", os.getenv("SDK_DEMO_USER_ID", "test-user"))
    user_id = os.getenv("SDK_DEMO_USER_ID", owner_id)

    session = bootstrap_openai_injected_session(
        owner_id=owner_id,
        user_id=user_id,
        agent_role="sdk_demo",
        source="python-quickstart",
    )

    response = session.openai_client.chat.completions.create(
        model=os.getenv("AI_GATEWAY_MODEL", "alibaba/qwen-3-14b"),
        messages=[
            {"role": "user", "content": "We switched to Redis Streams for async events."},
            {"role": "user", "content": "List the key decision, TODO, and risk."},
        ],
    )
    print("memory_id:", session.memory_id)
    print(response.choices[0].message.content)


if __name__ == "__main__":
    main()
