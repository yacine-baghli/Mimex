import { FormEvent, useMemo, useState } from "react";

type Priority = "Basse" | "Normale" | "Haute";

type Customer = {
  id: string;
  name: string;
  company: string;
  priority: Priority;
  createdAt: string;
};

const seedCustomers: Customer[] = [
  {
    id: "seed-1",
    name: "Grace Hopper",
    company: "Compiler Labs",
    priority: "Haute",
    createdAt: "18 juil. 2026",
  },
  {
    id: "seed-2",
    name: "Alan Turing",
    company: "Bletchley Systems",
    priority: "Normale",
    createdAt: "17 juil. 2026",
  },
];

const storageKey = "ginse-demo-customers-v1";

function loadCustomers(): Customer[] {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return seedCustomers;

  try {
    return JSON.parse(stored) as Customer[];
  } catch {
    return seedCustomers;
  }
}

export function App() {
  const [customers, setCustomers] = useState<Customer[]>(loadCustomers);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const highPriorityCount = useMemo(
    () => customers.filter((customer) => customer.priority === "Haute").length,
    [customers],
  );

  function saveCustomers(nextCustomers: Customer[]) {
    setCustomers(nextCustomers);
    localStorage.setItem(storageKey, JSON.stringify(nextCustomers));
  }

  function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("customer_name") ?? "").trim();
    const company = String(form.get("company_name") ?? "").trim();
    const priority = String(form.get("priority") ?? "Normale") as Priority;

    if (!name || !company) return;

    const customer: Customer = {
      id: crypto.randomUUID(),
      name,
      company,
      priority,
      createdAt: new Intl.DateTimeFormat("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date()),
    };

    saveCustomers([customer, ...customers]);
    setIsFormOpen(false);
    setNotice(`Client créé : ${name}`);
  }

  function resetDemo() {
    saveCustomers(seedCustomers);
    setIsFormOpen(false);
    setNotice("Données de démonstration réinitialisées");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="GINSE CRM">
          <span className="brand-mark">G</span>
          <span>GINSE</span>
        </div>

        <nav aria-label="Navigation principale">
          <a className="nav-item" href="#dashboard">
            <span aria-hidden="true">⌂</span> Vue d’ensemble
          </a>
          <a className="nav-item active" href="#customers" aria-current="page">
            <span aria-hidden="true">◎</span> Clients
          </a>
          <a className="nav-item" href="#activity">
            <span aria-hidden="true">↗</span> Activité
          </a>
        </nav>

        <div className="demo-card">
          <span className="eyebrow">MODE DÉMO</span>
          <p>Un environnement local, sûr et réinitialisable.</p>
          <button className="text-button" type="button" onClick={resetDemo}>
            Réinitialiser les données
          </button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="breadcrumb">Espace de démonstration / Clients</p>
            <h1>Clients</h1>
          </div>
          <button className="primary-button" type="button" onClick={() => setIsFormOpen(true)}>
            <span aria-hidden="true">＋</span> Nouveau client
          </button>
        </header>

        {notice ? (
          <div className="notice" role="status">
            <span aria-hidden="true">✓</span>
            <span>{notice}</span>
            <button type="button" aria-label="Fermer la notification" onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        ) : null}

        <section className="metrics" aria-label="Indicateurs clients">
          <article>
            <p>Clients actifs</p>
            <strong>{customers.length}</strong>
            <span>dans cet espace</span>
          </article>
          <article>
            <p>Priorité haute</p>
            <strong>{highPriorityCount}</strong>
            <span>à suivre aujourd’hui</span>
          </article>
          <article>
            <p>Dernière création</p>
            <strong className="compact-value">{customers[0]?.createdAt ?? "—"}</strong>
            <span>{customers[0]?.name ?? "Aucun client"}</span>
          </article>
        </section>

        <section className="panel" id="customers" aria-labelledby="customer-list-title">
          <div className="panel-heading">
            <div>
              <h2 id="customer-list-title">Répertoire clients</h2>
              <p>Les fiches les plus récentes apparaissent en premier.</p>
            </div>
            <label className="search-field">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Rechercher un client</span>
              <input type="search" placeholder="Rechercher" disabled />
            </label>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Entreprise</th>
                  <th>Priorité</th>
                  <th>Créé le</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} data-customer-name={customer.name}>
                    <td>
                      <span className="avatar" aria-hidden="true">
                        {customer.name
                          .split(" ")
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")}
                      </span>
                      <strong>{customer.name}</strong>
                    </td>
                    <td>{customer.company}</td>
                    <td>
                      <span className={`priority priority-${customer.priority.toLowerCase()}`}>
                        {customer.priority}
                      </span>
                    </td>
                    <td>{customer.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {isFormOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsFormOpen(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-customer-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">NOUVELLE FICHE</span>
                <h2 id="new-customer-title">Créer un client</h2>
                <p>Renseignez les informations nécessaires au suivi.</p>
              </div>
              <button className="icon-button" type="button" aria-label="Fermer" onClick={() => setIsFormOpen(false)}>
                ×
              </button>
            </div>

            <form onSubmit={createCustomer}>
              <label>
                Nom complet
                <input name="customer_name" type="text" required autoFocus placeholder="ex. Ada Lovelace" />
              </label>
              <label>
                Entreprise
                <input name="company_name" type="text" required placeholder="ex. Analytical Engines" />
              </label>
              <label>
                Priorité
                <select name="priority" defaultValue="Normale" required>
                  <option>Basse</option>
                  <option>Normale</option>
                  <option>Haute</option>
                </select>
              </label>

              <div className="form-actions">
                <button className="secondary-button" type="button" onClick={() => setIsFormOpen(false)}>
                  Annuler
                </button>
                <button className="primary-button" type="submit">
                  Enregistrer
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
