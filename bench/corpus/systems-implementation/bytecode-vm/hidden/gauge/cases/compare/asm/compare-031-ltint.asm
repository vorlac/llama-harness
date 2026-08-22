; case compare-031-ltint
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT -9223372036854775808
  LT
  PRINT
  RET
.end
