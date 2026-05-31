Write full HTML, CSS, and JavaScript for a stunning, bold, creative, unique light-mode landing page for a website about LLMs. Before you start, pick one specific angle/theme (not a generic AI SaaS vibe) and make the whole page commit to it in design and copy.

Also add real OpenRouter API support so the page can power whatever interactive features you invent (not necessarily a chatbot): include a Settings panel where the user can paste an OpenRouter API key (store it in localStorage), fetch the live model list from OpenRouter for a searchable model picker, and build 2-3 interactive features that use the API in ways that fit your chosen angle.

Use these OpenRouter cURL examples as the integration contract:

List available models (use this to populate the model picker) curl https://openrouter.ai/api/v1/models -H "Authorization: Bearer $OPENROUTER_API_KEY"

Call a model (non-streaming) curl https://openrouter.ai/api/v1/chat/completions -H "Authorization: Bearer $OPENROUTER_API_KEY" -H "Content-Type: application/json" -d '{ "model": "x-ai/grok-4.1-fast", "messages": [ {"role": "user", "content": "Your instruction or input here"} ] }'

Call a model (streaming SSE) curl https://openrouter.ai/api/v1/chat/completions -H "Authorization: Bearer $OPENROUTER_API_KEY" -H "Content-Type: application/json" -d '{ "model": "x-ai/grok-4.1-fast", "messages": [ {"role": "user", "content": "Your instruction or input here"} ], "stream": true }'

Client-side streaming notes (IF you use streaming):

The response is Server-Sent Events (SSE) lines like: data: {json...} and ends with data: [DONE].

Each JSON chunk contains incremental text in: choices[0].delta.content (when present).

Render incrementally as chunks arrive.

Return only a single self-contained index.html (Tailwind CDN ok). Do not log the API key, and don't hardcode a model list: always fetch models from the API.

That's only if you're surfacing the chat or model selection to the user, which you don't necessarily want to do. You might come up with some other creative uses of the LLMs in the background to power other features. In which case, you can just use the default model ID shown in the documentation I gave you.

Note that I don't want you to come up with generic features. For example, some sort of input box with a pre-specified prompt that you'll send to one or multiple models and get an interesting output. That's not interesting to the user at all.

The idea is to teach them about the things that LLMs can do by showing them actual useful use cases like research, code generation, brainstorming, and more. It's not to show them that they can type something into a text box and get something out. Almost everyone understands that at this point. So we don't want text in, text out. Come up with something more creative.

LLMs can produce complex data structures or code if you need them to.

Not that we just want them generating code, since this is to introduce people to LLMs.

We might have one thing that's text in, text out to get the idea, but we want them thinking a lot bigger than that. That should only be one among many demonstrations.
