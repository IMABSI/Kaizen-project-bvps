import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "./i18n";
import { AuthProvider } from "./context/AuthContext";
import { AppRoutes } from "./App";
import api from "./api";

vi.mock("./api", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }, TOKEN_KEY: "kaizen_token" }));

const me = (extra = {}) => ({ id: 1, tabel_number: 7, full_name: "Мастер Мастеров", post_title: "Мастер", department: null, language: "ru", theme: "system", ...extra });

function renderAt(path) {
  localStorage.setItem("kaizen_token", "tok");
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

const card = (extra = {}) => ({
  id: 12, number: 12, title: "Стеллаж для деталей", category: "efficiency", status: "sent", impl_status: "implemented", implemented_on: "2026-11-10",
  operator_tabel: 321, operator_name: "Оператор Один", operator_post: "Оператор", submitter_tabel: 7, submitter_name: "Мастер Мастеров",
  department_name: "Логистика", area: "Склад 2", equipment: null, noticed_on: null, effort: "low", currency: "UZS", cost_amount: 100000, saving_month_amount: null,
  participants: null, problem_text: "Долго ищем детали", before_text: null, after_text: "Сделали разметку", benefits_text: null, conclusion_text: null,
  wastes: ["waiting"], effects: ["time"], measures: [{ id: 1, name: "Поиск", unit: "мин", before_value: 12, after_value: 8, better: "lower", change_pct: -33.3, improved: true }],
  photos: [], history: [{ id: 1, status: "sent", comment: null, changed_at: "2026-11-12 08:00:00" }], created_at: "2026-11-12 08:00:00",
  admin_comment: null, deleted_at: null, can_edit: true, edit_deadline: "2026-11-13 08:00:00", ...extra,
});

beforeEach(() => vi.resetAllMocks());

function mockApi({ user = me(), kaizen = card(), list = [], team = [] } = {}) {
  api.get.mockImplementation((url) => {
    if (url === "/auth/me") return Promise.resolve({ data: { user } });
    if (url === "/team") return Promise.resolve({ data: { owner: user, members: team } });
    if (url === "/kaizens") return Promise.resolve({ data: { kaizens: list } });
    if (/^\/kaizens\/\d+$/.test(url)) return Promise.resolve({ data: { kaizen } });
    return Promise.resolve({ data: {} });
  });
}

describe("список", () => {
  it("показывает карточки с номером, автором идеи, статусом; «Мои» запрашивает mine=1", async () => {
    mockApi({ list: [{ id: 12, number: 12, title: "Стеллаж", category: "cost", status: "accepted", operator_tabel: 321, operator_name: "Оператор Один", department_name: "Логистика", created_at: "2026-11-12 08:00:00", photo_count: 2, deleted_at: null }] });
    renderAt("/");
    expect(await screen.findByText("Стеллаж")).toBeInTheDocument();
    expect(screen.getByText("№12")).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getByText("Принят")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/kaizens", { params: { mine: "1" } });
    await userEvent.click(screen.getByRole("button", { name: "Все" }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/kaizens", { params: {} }));
  });
});

describe("форма", () => {
  it("отправляет все поля в нужном виде: числа, null для пустых, замеры, оператор", async () => {
    mockApi({ team: [{ id: 5, parent_id: null, tabel_number: 321, full_name: "Оператор Один", post_title: "Оператор" }] });
    api.post.mockResolvedValue({ data: { kaizen: card() } });
    renderAt("/kaizens/new");
    await userEvent.type(await screen.findByLabelText(/^Название/), "Новая идея");
    await userEvent.type(screen.getByLabelText("1. Проблема"), "Проблема описана");
    await userEvent.type(screen.getByLabelText("3. Что сделано / как стало (после)"), "Решение описано");
    await userEvent.click(screen.getByLabelText("Ожидание"));
    await userEvent.click(screen.getByLabelText("Время"));
    await userEvent.selectOptions(screen.getByLabelText(/^Автор идеи/), "5");
    await userEvent.click(screen.getByRole("button", { name: /Добавить замер/ }));
    await userEvent.type(screen.getByLabelText("Показатель"), "Время поиска");
    await userEvent.type(screen.getByLabelText("До"), "12");
    await userEvent.type(screen.getByLabelText("После"), "8");
    expect(screen.getByText("-33.3%")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Затраты на внедрение"), "150000");
    await userEvent.click(screen.getByRole("button", { name: "Отправить кайдзен" }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe("/kaizens");
    expect(body).toMatchObject({
      title: "Новая идея", category: "efficiency", area: null, equipment: null, noticed_on: null, before_text: null, conclusion_text: null,
      wastes: ["waiting"], effects: ["time"], impl_status: "idea", implemented_on: null, effort: null, currency: "UZS",
      cost_amount: 150000, saving_month_amount: null, member_id: 5,
      measures: [{ name: "Время поиска", unit: null, before_value: 12, after_value: 8, better: "lower" }],
    });
    expect(await screen.findByText("Кайдзен № 12")).toBeInTheDocument();
  });

  it("ошибка сервера показывается на языке интерфейса с именем поля", async () => {
    mockApi();
    api.post.mockRejectedValue({ response: { status: 400, data: { code: "kaizen_invalid_input", error: "x", field: "title" } } });
    renderAt("/kaizens/new");
    await userEvent.type(await screen.findByLabelText(/^Название/), "Новая идея");
    await userEvent.type(screen.getByLabelText("1. Проблема"), "Проблема описана");
    await userEvent.type(screen.getByLabelText("3. Что сделано / как стало (после)"), "Решение описано");
    await userEvent.click(screen.getByRole("button", { name: "Отправить кайдзен" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Проверьте заполнение формы (title)");
  });

  it("фото: ставится в очередь, лимит 4 на блок, после сохранения уходит на сервер с block и типом", async () => {
    mockApi();
    api.post.mockImplementation((url) => Promise.resolve({ data: url === "/kaizens" ? { kaizen: card() } : { photo: {} } }));
    renderAt("/kaizens/new");
    await userEvent.type(await screen.findByLabelText(/^Название/), "Новая идея");
    await userEvent.type(screen.getByLabelText("1. Проблема"), "Проблема описана");
    await userEvent.type(screen.getByLabelText("3. Что сделано / как стало (после)"), "Решение описано");
    const section = screen.getByLabelText("1. Проблема").closest("section");
    const input = section.querySelector('input[type="file"]');
    const files = Array.from({ length: 5 }, (_, i) => new File([new Uint8Array(10)], `p${i}.jpg`, { type: "image/jpeg" }));
    await userEvent.upload(input, files);
    expect(within(section).getAllByRole("button", { name: "Убрать фото" })).toHaveLength(4);
    expect(within(section).getByText(/4\/4/)).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: /Добавить фото/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Отправить кайдзен" }));
    await waitFor(() => expect(api.post.mock.calls.filter((c) => c[0] === "/kaizens/12/photos")).toHaveLength(4));
    const photoCall = api.post.mock.calls.find((c) => c[0] === "/kaizens/12/photos");
    expect(photoCall[2].params.block).toBe("problem");
    expect(photoCall[2].headers["Content-Type"]).toBe("image/jpeg");
  });

  it("недопустимый тип файла отклоняется до отправки", async () => {
    mockApi();
    renderAt("/kaizens/new");
    const section = (await screen.findByLabelText("1. Проблема")).closest("section");
    const pdf = new File([new Uint8Array(10)], "a.pdf", { type: "application/pdf" });
    await userEvent.upload(section.querySelector('input[type="file"]'), pdf, { applyAccept: false });
    expect(await screen.findByRole("alert")).toHaveTextContent("Допустимы только фото JPEG, PNG или WebP");
  });
});

describe("карточка", () => {
  it("показывает данные, замеры с процентом и водяной знак с табельным автора идеи", async () => {
    mockApi();
    renderAt("/kaizens/12");
    expect(await screen.findByText("Кайдзен № 12")).toBeInTheDocument();
    expect(screen.getByText("Долго ищем детали")).toBeInTheDocument();
    expect(screen.getByText("-33.3%")).toBeInTheDocument();
    expect(screen.getByText("Склад 2")).toBeInTheDocument();
    const wm = screen.getByTestId("watermark");
    expect(wm.textContent).toContain("№321");
    expect(wm.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("button", { name: /Печать A4/ })).toBeInTheDocument();
    // обычный мастер: блока управления статусом нет
    expect(screen.queryByText("Управление (администратор)")).not.toBeInTheDocument();
  });

  it("менеджер видит управление: смена статуса и продление правки", async () => {
    mockApi({ user: me({ perm_manage_kaizens: 1 }) });
    api.put.mockResolvedValue({ data: {} });
    api.post.mockResolvedValue({ data: {} });
    renderAt("/kaizens/12");
    await screen.findByText("Управление (администратор)");
    await userEvent.selectOptions(screen.getByLabelText("Статус"), "accepted");
    await userEvent.type(screen.getByPlaceholderText("Комментарий"), "Хорошая идея");
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/kaizens/12/status", { status: "accepted", comment: "Хорошая идея" }));
    await userEvent.click(screen.getByRole("button", { name: "Разрешить" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/kaizens/12/allow-edit", { hours: 24 }));
  });

  it("если правка закрыта — нет кнопок «Изменить»/«Удалить», есть пояснение", async () => {
    mockApi({ kaizen: card({ can_edit: false }) });
    renderAt("/kaizens/12");
    await screen.findByText("Кайдзен № 12");
    expect(screen.queryByRole("link", { name: "Изменить" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Удалить" })).not.toBeInTheDocument();
    expect(screen.getByText("Срок правки истёк")).toBeInTheDocument();
  });

  it("ошибка доступа переводится", async () => {
    mockApi();
    api.get.mockImplementation((url) => url === "/auth/me" ? Promise.resolve({ data: { user: me() } }) : Promise.reject({ response: { status: 403, data: { code: "forbidden" } } }));
    renderAt("/kaizens/99");
    expect(await screen.findByRole("alert")).toHaveTextContent("Недостаточно прав");
  });
});
