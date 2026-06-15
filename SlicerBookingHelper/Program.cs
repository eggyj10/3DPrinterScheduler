namespace SlicerBookingHelper;

internal static class Program
{
    /// Invoked by the slicer as a post-processing script. The slicer appends
    /// the path of the freshly generated G-code file as the last argument.
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        var config = HelperConfig.Load();

        var gcodePath = args.LastOrDefault(a => !a.StartsWith('-'));
        if (string.IsNullOrWhiteSpace(gcodePath) || !File.Exists(gcodePath))
        {
            MessageBox.Show(
                "Slicer Booking Helper is a post-processing script for Bambu Studio / "
              + "Orca-Flashforge.\n\nIt expects the path to a sliced G-code file as its "
              + "argument and is normally launched by the slicer, not run directly.",
                "Slicer Booking Helper",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        GcodeMetadata meta;
        try
        {
            meta = GcodeMetadata.Parse(gcodePath);
        }
        catch
        {
            // Even if parsing fails we still want to nudge the student to book,
            // just without prefilled numbers.
            meta = new GcodeMetadata();
        }

        using var form = new BookingPromptForm(meta, config);
        Application.Run(form);
    }
}
