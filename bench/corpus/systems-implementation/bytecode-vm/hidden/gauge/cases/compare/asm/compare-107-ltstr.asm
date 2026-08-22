; case compare-107-ltstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "~"
  PUSH_STR "!"
  LT
  PRINT
  RET
.end
