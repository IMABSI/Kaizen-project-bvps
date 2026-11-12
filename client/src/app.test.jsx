import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "./i18n";
import { AuthProvider } from "./context/AuthContext";
import { AppRoutes } from "./App";
import api from "./api";

vi.mock("./api", () => {
  const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
  return { default: api, TOKEN_KEY: "kaizen_token" };
});

function renderApp(path = "/") {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </I18nProvider>
  );
}
const user = (extra = {}) => ({ id: 1, tabel_number: 7, full_name: "Тест Тестов", post_title: "Мастер", department: null, language: "ru", theme: "system", ...extra });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("вход", () => {
  it("без токена показывает форму входа", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Вход" })).toBeInTheDocument();
  });

  it("успешный вход по табельному номеру", async () => {
    api.post.mockResolvedValue({ data: { token: "tok", user: user() } });
    api.get.mockResolvedValue({ data: { kaizens: [] } });
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("Табельный номер"), "7");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret1234");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/login", { tabel_number: "7", password: "secret1234" }));
    expect(await screen.findByText("Мои предложения")).toBeInTheDocument();
    expect(localStorage.getItem("kaizen_token")).toBe("tok");
  });

  it("ошибка сервера переводится по коду на выбранный язык", async () => {
    api.post.mockRejectedValue({ response: { status: 401, data: { code: "invalid_credentials", error: "рус" } } });
    renderApp("/login");
    await userEvent.click(await screen.findByRole("button", { name: "EN" }));
    await userEvent.type(screen.getByLabelText("Badge number"), "7");
    await userEvent.type(screen.getByLabelText("Password"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong badge number or password");
  });

  it("язык и тема переключаются и запоминаются локально", async () => {
    renderApp("/login");
    await userEvent.click(await screen.findByRole("button", { name: "UZ" }));
    expect(await screen.findByRole("heading", { name: "Kirish" })).toBeInTheDocument();
    expect(localStorage.getItem("kaizen_lang")).toBe("uz");
    await userEvent.click(screen.getByTitle("Qorong‘i"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("активация", () => {
  it("несовпадающие пароли не отправляются", async () => {
    renderApp("/activate");
    await userEvent.type(await screen.findByLabelText("Табельный номер"), "9");
    await userEvent.type(screen.getByLabelText("Код активации"), "ABCD-2345");
    await userEvent.type(screen.getByLabelText(/Новый пароль/), "password1");
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "password2");
    await userEvent.click(screen.getByRole("button", { name: "Задать пароль и войти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Пароли не совпадают");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("успешная активация входит в систему", async () => {
    api.post.mockResolvedValue({ data: { token: "t2", user: user() } });
    api.get.mockResolvedValue({ data: { kaizens: [] } });
    renderApp("/activate");
    await userEvent.type(await screen.findByLabelText("Табельный номер"), "9");
    await userEvent.type(screen.getByLabelText("Код активации"), "ABCD-2345");
    await userEvent.type(screen.getByLabelText(/Новый пароль/), "password1");
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "password1");
    await userEvent.click(screen.getByRole("button", { name: "Задать пароль и войти" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/activate", { tabel_number: "9", activation_code: "ABCD-2345", new_password: "password1" }));
    expect(await screen.findByText("Мои предложения")).toBeInTheDocument();
  });
});

describe("доступ по ролям", () => {
  async function signedIn(u) {
    localStorage.setItem("kaizen_token", "tok");
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return Promise.resolve({ data: { user: u } });
      if (url === "/kaizens") return Promise.resolve({ data: { kaizens: [] } });
      return Promise.resolve({ data: { users: [], departments: [] } });
    });
  }

  it("обычный мастер не видит админских пунктов меню и уходит с админских страниц", async () => {
    await signedIn(user());
    renderApp("/admin/users");
    expect(await screen.findByText("Мои предложения")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Пользователи" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Моя команда" })).toBeInTheDocument();
  });

  it("менеджер пользователей видит раздел и может создать мастера (код показывается)", async () => {
    await signedIn(user({ perm_manage_users: 1 }));
    api.post.mockResolvedValue({ data: { user: user({ id: 5, tabel_number: 55, full_name: "Новый" }), activation_code: "ABCD-2345", activation_expires_at: "2026-11-19 10:00:00" } });
    renderApp("/admin/users");
    await userEvent.type(await screen.findByPlaceholderText("Табельный №"), "55");
    await userEvent.type(screen.getByPlaceholderText("ФИО"), "Новый Мастер");
    await userEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(await screen.findByText("ABCD-2345")).toBeInTheDocument();
  });
});
