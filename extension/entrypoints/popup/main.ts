import "@/lib/style.css";
import { api, getToken, pageInfo } from "@/lib/api";
import { clearResult } from "@/lib/badge";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let signupMode = false;

async function render() {
  const loggedIn = Boolean(await getToken());
  $("login").hidden = loggedIn;
  $("main").hidden = !loggedIn;
  (loggedIn ? $("word") : $("login").querySelector("input"))?.focus();
}

$("mode-toggle").addEventListener("click", () => {
  signupMode = !signupMode;
  $("login-title").textContent = signupMode ? "Create an account" : "Log in";
  $("login-submit").textContent = signupMode ? "Sign up" : "Log in";
  $("mode-toggle").textContent = signupMode ? "I already have an account" : "Create an account";
  $("invite-row").hidden = !signupMode;
  $("invite-row").querySelector("input")!.required = signupMode;
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target as HTMLFormElement);
  const creds = { email: String(form.get("email")), password: String(form.get("password")) };
  const button = $<HTMLButtonElement>("login-submit");
  button.disabled = true;
  $("login-msg").textContent = "";
  try {
    if (signupMode) await api.signup({ ...creds, inviteCode: String(form.get("inviteCode")) });
    else await api.login(creds);
    await render();
  } catch (err) {
    $("login-msg").textContent = (err as Error).message;
  } finally {
    button.disabled = false;
  }
});

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("word");
  const msg = $("msg");
  msg.className = "";
  msg.textContent = "Saving…";
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const word = await api.saveWord({ text: input.value, ...pageInfo(tab) });
    msg.textContent = `Saved "${word.text}"`;
    input.value = "";
  } catch (err) {
    msg.className = "error";
    msg.textContent = (err as Error).message;
    await render(); // a 401 clears the token, so this switches to the login form
  }
});

$("open-book").addEventListener("click", () => browser.runtime.openOptionsPage());
$("logout").addEventListener("click", async () => {
  await api.logout();
  await render();
});

void clearResult(); // the user has now seen any error badge
void render();
