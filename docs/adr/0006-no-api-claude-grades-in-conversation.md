# AI の API は使わず、記述式は MANUAL にして会話の Claude が採点する

利用者は API の別課金を避けたい。そこで LLM の API 呼び出しは使わず、記述式の問題は MANUAL にする。回答が Results に入ったら、会話の Claude がルーブリックに沿って manual_score と理由を書き込み、教師がメニューで確定する。LLM 提供元の追加（OpenAI・Gemini）は行わない。API 呼び出しの実装は残すが、既定では使わない。
