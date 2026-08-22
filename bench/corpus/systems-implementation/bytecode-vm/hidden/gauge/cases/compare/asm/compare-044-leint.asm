; case compare-044-leint
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  PUSH_INT 9223372036854775807
  LE
  PRINT
  RET
.end
