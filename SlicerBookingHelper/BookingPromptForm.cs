using System.Diagnostics;

namespace SlicerBookingHelper;

/// The "this print must be booked" prompt that pops up on top of the slicer
/// after a slice. Modal and topmost so the student has to acknowledge it.
public sealed class BookingPromptForm : Form
{
    private readonly GcodeMetadata _meta;
    private readonly HelperConfig _config;

    // Width available for wrapping text inside the form's padded content area.
    private const int TextWidth = 380;

    public BookingPromptForm(GcodeMetadata meta, HelperConfig config)
    {
        _meta = meta;
        _config = config;

        Text = "Booking required";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MinimizeBox = false;
        MaximizeBox = false;
        ShowInTaskbar = true;
        TopMost = config.AlwaysOnTop;
        Font = new Font("Segoe UI", 9.75f);

        // Let WinForms scale every control by the font (DPI-aware) and grow the
        // window to fit its contents instead of using fixed pixel sizes.
        AutoScaleMode = AutoScaleMode.Font;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;

        if (config.OfflineMode)
            BuildOfflineLayout();
        else
            BuildLayout();
    }

    private static TableLayoutPanel NewRoot() => new()
    {
        Dock = DockStyle.Fill,
        AutoSize = true,
        AutoSizeMode = AutoSizeMode.GrowAndShrink,
        ColumnCount = 1,
        Padding = new Padding(16),
        GrowStyle = TableLayoutPanelGrowStyle.AddRows,
    };

    private static Label NewHeading() => new()
    {
        Text = "⚠  This print must be booked",
        Font = new Font("Segoe UI Semibold", 13f, FontStyle.Bold),
        AutoSize = true,
        MaximumSize = new Size(TextWidth, 0),
        Margin = new Padding(0, 0, 0, 8),
    };

    private static Label NewBlurb(string text) => new()
    {
        Text = text,
        AutoSize = true,
        MaximumSize = new Size(TextWidth, 0),
        Margin = new Padding(0, 0, 0, 8),
    };

    private TableLayoutPanel NewDetails(bool offline, int canonicalWeight, bool haveWeight)
    {
        var details = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 2,
            Margin = new Padding(0, 0, 0, 8),
        };
        details.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        details.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        AddRow(details, "Filament:", string.IsNullOrWhiteSpace(_meta.FilamentType) ? "—" : _meta.FilamentType);
        AddRow(details, "Weight:", offline
            ? (haveWeight ? $"{canonicalWeight} g" : "—")
            : (_meta.WeightGrams is { } g ? $"{g:0.##} g" : "—"));
        AddRow(details, "Est. time:", _meta.EstimatedMinutes is { } m ? FormatMinutes(m) : "—");
        return details;
    }

    private void BuildLayout()
    {
        var root = NewRoot();

        root.Controls.Add(NewHeading());
        root.Controls.Add(NewBlurb(
            "Before you print, log this job on the 3D Printer Scheduler. "
          + "The button below opens the booking form with these details filled in."));
        root.Controls.Add(NewDetails(offline: false, canonicalWeight: 0, haveWeight: false));

        var bookBtn = new Button
        {
            Text = "Book this print",
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Anchor = AnchorStyles.Right,
            Padding = new Padding(12, 4, 12, 4),
            Margin = new Padding(0, 4, 0, 0),
        };
        bookBtn.Click += (_, _) =>
        {
            // Get the prompt out of the way, open the booking page, then exit.
            Hide();
            OpenBookingPage();
            Close();
        };
        root.Controls.Add(bookBtn);

        Controls.Add(root);
        AcceptButton = bookBtn;
    }

    /// Offline-mode layout: no browser. Shows the details, the exact weight the
    /// student must book on the scheduler, and a box to type the code the
    /// scheduler hands back. The code only matches if they booked the true weight.
    private void BuildOfflineLayout()
    {
        // Canonical weight must match the scheduler's rounding so the codes agree.
        int canonicalWeight = Math.Max(1, (int)Math.Round(_meta.WeightGrams ?? 0, MidpointRounding.AwayFromZero));
        bool haveWeight = _meta.WeightGrams is > 0;

        var root = NewRoot();

        root.Controls.Add(NewHeading());
        root.Controls.Add(NewBlurb(haveWeight
            ? $"On the 3D Printer Scheduler, book this print at exactly {canonicalWeight} g. "
            + "Then type the booking code it shows you below to unlock."
            : "This sliced file has no weight, so it can't be verified offline. "
            + "Book it manually on the scheduler, then skip."));
        root.Controls.Add(NewDetails(offline: true, canonicalWeight, haveWeight));

        var entryPanel = new FlowLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            FlowDirection = FlowDirection.LeftToRight,
            Margin = new Padding(0, 0, 0, 4),
        };
        var codeLabel = new Label
        {
            Text = "Booking code:",
            Font = new Font("Segoe UI Semibold", 9.75f, FontStyle.Bold),
            AutoSize = true,
            Anchor = AnchorStyles.Left,
            Margin = new Padding(0, 8, 8, 0),
        };
        var codeBox = new TextBox
        {
            Width = 120,
            MaxLength = 6,
            Font = new Font("Consolas", 13f),
            Margin = new Padding(0, 2, 0, 0),
            Enabled = haveWeight,
        };
        codeBox.KeyPress += (_, e) =>
        {
            // Digits only.
            if (!char.IsControl(e.KeyChar) && !char.IsDigit(e.KeyChar)) e.Handled = true;
        };
        entryPanel.Controls.Add(codeLabel);
        entryPanel.Controls.Add(codeBox);
        root.Controls.Add(entryPanel);

        var status = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(TextWidth, 0),
            ForeColor = Color.Firebrick,
            Margin = new Padding(0, 0, 0, 8),
        };
        root.Controls.Add(status);

        var unlockBtn = new Button
        {
            Text = "Unlock",
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Anchor = AnchorStyles.Right,
            Padding = new Padding(12, 4, 12, 4),
            Margin = new Padding(0, 4, 0, 0),
            Enabled = haveWeight,
        };
        unlockBtn.Click += (_, _) =>
        {
            var expected = BookingCodes.Generate(canonicalWeight, _config.BookingCodeSecret);
            if (string.Equals(codeBox.Text.Trim(), expected, StringComparison.Ordinal))
            {
                DialogResult = DialogResult.OK;
                Close();
            }
            else
            {
                status.Text = "That code doesn't match. Check the weight you booked.";
                codeBox.SelectAll();
                codeBox.Focus();
            }
        };
        root.Controls.Add(unlockBtn);

        Controls.Add(root);
        AcceptButton = unlockBtn;
    }

    private static void AddRow(TableLayoutPanel panel, string label, string value)
    {
        panel.Controls.Add(new Label
        {
            Text = label,
            Font = new Font("Segoe UI Semibold", 9.75f, FontStyle.Bold),
            AutoSize = true,
            Anchor = AnchorStyles.Left,
            Margin = new Padding(0, 4, 12, 4),
        });
        panel.Controls.Add(new Label
        {
            Text = value,
            AutoSize = true,
            Anchor = AnchorStyles.Left,
            Margin = new Padding(0, 4, 0, 4),
        });
    }

    private static string FormatMinutes(int minutes)
    {
        var h = minutes / 60;
        var m = minutes % 60;
        return h > 0 ? $"{h}h {m}m" : $"{m}m";
    }

    private void OpenBookingPage()
    {
        var url = _meta.BuildBookingUrl(_config.BaseUrl);
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"Couldn't open the booking page.\n\n{url}\n\n{ex.Message}",
                "Booking required",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
    }
}
