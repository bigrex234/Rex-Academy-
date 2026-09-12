/* ============================================================
   REX Academy — frontend logic
   Uses the Supabase anon (public) key only. All privileged work
   (enforcing the 10-seat cap, generating codes, sending email)
   happens server-side in Postgres + an Edge Function.
   ============================================================ */

// ---- CONFIG: replace with your own project values ----
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-PUBLIC-ANON-KEY";
const TELEGRAM_URL = "https://t.me/+y2xus0tB3OAyNTY0";
const TOTAL_SEATS = 10;
// --------------------------------------------------------

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const els = {
  pillSlots: document.getElementById("pillSlots"),
  slotsRemaining: document.getElementById("slotsRemaining"),
  counterFill: document.getElementById("counterFill"),
  counterNote: document.getElementById("counterNote"),

  formView: document.getElementById("formView"),
  resultView: document.getElementById("resultView"),
  soldoutView: document.getElementById("soldoutView"),

  form: document.getElementById("applyForm"),
  fullName: document.getElementById("fullName"),
  software: document.getElementById("software"),
  formError: document.getElementById("formError"),
  submitBtn: document.getElementById("submitBtn"),

  codeDisplay: document.getElementById("codeDisplay"),
  metaNumber: document.getElementById("metaNumber"),
  metaSoftware: document.getElementById("metaSoftware"),
};

const SOFTWARE_LABELS = {
  AE: "After Effects",
  AM: "Alight Motion",
  BL: "Blurrr",
};

function setError(msg) {
  els.formError.textContent = msg;
  els.formError.classList.toggle("show", Boolean(msg));
}

function setLoading(isLoading) {
  els.submitBtn.disabled = isLoading;
  els.submitBtn.classList.toggle("loading", isLoading);
}

function showSoldOut() {
  els.formView.classList.add("hide");
  els.resultView.classList.remove("show");
  els.soldoutView.classList.add("show");
}

function updateCounterUI(takenCount) {
  const remaining = Math.max(TOTAL_SEATS - takenCount, 0);
  const pct = (remaining / TOTAL_SEATS) * 100;

  els.slotsRemaining.textContent = remaining;
  els.counterFill.style.width = pct + "%";
  els.pillSlots.textContent = remaining > 0
    ? `${remaining} of ${TOTAL_SEATS} seats left`
    : "All seats claimed";

  if (remaining === 0) {
    els.counterNote.textContent = "This cohort is full — see you next time.";
    showSoldOut();
  } else if (remaining <= 3) {
    els.counterNote.textContent = "Almost gone — register now to lock in your spot.";
  } else {
    els.counterNote.textContent = "Seats are given out on a first-come, first-served basis.";
  }
}

// ---- Live seat count ----
// Counts rows in the public "students" table. Row Level Security
// (see supabase/schema.sql) allows anonymous SELECT of count only
// via a restricted view, so no student PII leaks to the browser.
async function refreshSeatCount() {
  try {
    const { count, error } = await supabaseClient
      .from("student_count_public")
      .select("*", { count: "exact", head: true });

    if (error) throw error;
    updateCounterUI(count ?? 0);
  } catch (err) {
    console.error("Could not load seat count:", err);
    els.counterNote.textContent = "Live count unavailable — you can still try registering.";
  }
}

refreshSeatCount();

// Keep the counter live as other students register.
supabaseClient
  .channel("students-count-channel")
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "students" },
    () => refreshSeatCount()
  )
  .subscribe();

// ---- Registration flow ----
els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");

  const fullName = els.fullName.value.trim();
  const software = els.software.value;

  if (fullName.length < 2) {
    setError("Enter your full name.");
    els.fullName.focus();
    return;
  }
  if (!software) {
    setError("Choose the software you want to learn.");
    return;
  }

  setLoading(true);

  try {
    // This calls a Postgres function (SECURITY DEFINER) that:
    //  1. locks the table, 2. checks the 10-seat cap,
    //  3. generates a unique REX-XX-XXXXXX code,
    //  4. inserts the student, 5. returns the new row.
    // This makes the "only 10 total" rule atomic and race-proof —
    // it can't be bypassed by two people submitting at once.
    const { data, error } = await supabaseClient.rpc("register_student", {
      p_full_name: fullName,
      p_software: software,
    });

    if (error) {
      if (error.message && error.message.includes("SEATS_FULL")) {
        showSoldOut();
        return;
      }
      throw error;
    }

    const student = Array.isArray(data) ? data[0] : data;
    if (!student) throw new Error("No student record returned.");

    // Fire the email notification via the Edge Function.
    // This uses the anon key only to invoke the function — the
    // Resend API key itself lives server-side as a secret and is
    // never exposed to the browser.
    supabaseClient.functions
      .invoke("notify-registration", {
        body: {
          full_name: student.full_name,
          software: student.software,
          student_code: student.student_code,
          student_number: student.student_number,
          created_at: student.created_at,
        },
      })
      .catch((err) => console.error("Email notification failed:", err));
    // Note: email sending happens best-effort and does not block
    // the student's success screen or redirect.

    // Show result
    els.codeDisplay.textContent = student.student_code;
    els.metaNumber.textContent = student.student_number;
    els.metaSoftware.textContent = SOFTWARE_LABELS[student.software] || student.software;

    els.formView.classList.add("hide");
    els.resultView.classList.add("show");

    refreshSeatCount();

    setTimeout(() => {
      window.location.href = TELEGRAM_URL;
    }, 2000);

  } catch (err) {
    console.error("Registration failed:", err);
    setError("Something went wrong. Please try again in a moment.");
  } finally {
    setLoading(false);
  }
});
