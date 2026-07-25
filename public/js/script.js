document.addEventListener("DOMContentLoaded", () => {
    const passwordButtons = document.querySelectorAll(
        "[data-toggle-password]"
    );

    passwordButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const inputId = button.dataset.togglePassword;
            const input = document.getElementById(inputId);

            if (!input) {
                return;
            }

            const passwordIsHidden = input.type === "password";

            input.type = passwordIsHidden ? "text" : "password";
            button.textContent = passwordIsHidden ? "Hide" : "Show";
        });
    });

    const signupForm = document.getElementById("signup-form");
    const passwordInput = document.getElementById("password");
    const confirmPasswordInput =
        document.getElementById("confirmPassword");
    const passwordMessage =
        document.getElementById("password-match-message");

    if (
        signupForm &&
        passwordInput &&
        confirmPasswordInput &&
        passwordMessage
    ) {
        function checkPasswordMatch() {
            if (!confirmPasswordInput.value) {
                passwordMessage.textContent = "";
                passwordMessage.className = "client-message";
                return;
            }

            if (passwordInput.value === confirmPasswordInput.value) {
                passwordMessage.textContent = "Passwords match.";
                passwordMessage.className =
                    "client-message success-message";
            } else {
                passwordMessage.textContent =
                    "Passwords do not match.";
                passwordMessage.className =
                    "client-message warning-message";
            }
        }

        passwordInput.addEventListener("input", checkPasswordMatch);
        confirmPasswordInput.addEventListener(
            "input",
            checkPasswordMatch
        );

        signupForm.addEventListener("submit", (event) => {
            if (
                passwordInput.value !== confirmPasswordInput.value
            ) {
                event.preventDefault();

                passwordMessage.textContent =
                    "Passwords must match before creating an account.";

                passwordMessage.className =
                    "client-message warning-message";

                confirmPasswordInput.focus();
            }
        });
    }
});

const aiFinanceForm = document.getElementById("ai-finance-form");
const aiQuestionInput = document.getElementById("ai-question");
const askAiButton = document.getElementById("ask-ai-button");
const aiResponse = document.getElementById("ai-response");
const aiResponseText = document.getElementById("ai-response-text");
const aiError = document.getElementById("ai-error");
const exampleButtons = document.querySelectorAll(
    ".ai-example-button"
);

exampleButtons.forEach((button) => {
    button.addEventListener("click", () => {
        if (!aiQuestionInput) {
            return;
        }

        aiQuestionInput.value = button.dataset.question;
        aiQuestionInput.focus();
    });
});

if (
    aiFinanceForm &&
    aiQuestionInput &&
    askAiButton &&
    aiResponse &&
    aiResponseText &&
    aiError
) {
    aiFinanceForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const question = aiQuestionInput.value.trim();

        if (!question) {
            aiError.textContent =
                "Please enter a financial planning question.";

            aiError.classList.remove("ai-hidden");
            aiResponse.classList.add("ai-hidden");

            return;
        }

        askAiButton.disabled = true;
        askAiButton.textContent = "Creating your plan...";

        aiError.classList.add("ai-hidden");
        aiResponse.classList.add("ai-hidden");
        aiResponseText.textContent = "";

        try {
            const response = await fetch("/api/financial-advice", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    question
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error ||
                        "DollarPlan AI could not answer the question."
                );
            }

            aiResponseText.innerHTML = marked.parse(data.answer);
            aiResponse.classList.remove("ai-hidden");
        } catch (error) {
            aiError.textContent = error.message;
            aiError.classList.remove("ai-hidden");
        } finally {
            askAiButton.disabled = false;
            askAiButton.textContent = "Ask DollarPlan AI";
        }
    });
}