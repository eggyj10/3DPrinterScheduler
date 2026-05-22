using System.ComponentModel.DataAnnotations;

namespace _3DPrinterSchedulerWeb.Models
{
    public class AppSetting
    {
        [Key]
        public string Key { get; set; } = "";
        public string Value { get; set; } = "";
    }
}
