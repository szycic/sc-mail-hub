/**
 * AI Settings Controller for SC Mail Hub.
 */

async function loadAISettings() {
  try {
    const res = await fetch("/api/ai/settings");
    if (!res.ok) return;
    const data = await res.json();

    const providerSelect = document.getElementById("ai-provider");
    const keyInput = document.getElementById("ai-key");
    const modelInput = document.getElementById("ai-model");

    if (providerSelect) providerSelect.value = data.provider;
    if (keyInput && data.api_key_configured) keyInput.placeholder = "••••••••••••••••••••••••••••••••";
    if (modelInput) modelInput.value = data.model_name || "";
  } catch (err) {
    console.error("AI Settings load error", err);
  }
}

async function saveAISettings() {
  const provider = document.getElementById("ai-provider").value;
  const key = document.getElementById("ai-key").value;
  const model = document.getElementById("ai-model").value;

  if (provider !== "mock" && !model.trim()) {
    showToast(`Model Name is required for ${provider.toUpperCase()}! Please enter a model name.`, "error");
    return;
  }

  try {
    const res = await fetch("/api/ai/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        api_key: key || null,
        model_name: model.trim()
      })
    });
    if (res.ok) {
      showToast("AI Settings updated!", "success");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function testAIConnection() {
  const provider = document.getElementById("ai-provider").value;
  const key = document.getElementById("ai-key").value;
  const model = document.getElementById("ai-model").value;

  if (provider !== "mock" && !model.trim()) {
    showToast(`Model Name is required to test ${provider.toUpperCase()} connection!`, "error");
    return;
  }

  showToast(`Testing ${provider.toUpperCase()} API connection...`, "info");

  try {
    const res = await fetch("/api/ai/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        api_key: key || null,
        model_name: model.trim()
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "AI API Connection Successful!", "success");
    } else {
      showToast(data.detail || "AI API Connection Test Failed", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}
