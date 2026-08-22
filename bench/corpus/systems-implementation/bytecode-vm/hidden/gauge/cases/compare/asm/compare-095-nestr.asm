; case compare-095-nestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "~"
  PUSH_STR "!"
  NE
  PRINT
  RET
.end
